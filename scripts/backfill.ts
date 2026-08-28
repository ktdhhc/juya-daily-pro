// backfill — spec02 3.4：全量回填 I/O 胶水。
// 纯逻辑（archive 解析 / issue 解析 / SQL 生成）已在 worker/sync/* 测过（ADR-0011）；
// 本脚本只做：fetch → parse → SQL 累积 → 临时 SQL 文件 → `wrangler d1 execute juya-daily --local --file`
// → 失败降级逐期分块 → counts 查询打印。全程零 Cloudflare 登录（仅 --local）。
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Item } from "../src/lib/schema";
import { parseArchiveDates } from "../worker/sync/archive";
import { parseIssue } from "../worker/sync/parse";
import { companiesUpsertSql, itemsUpsertSql, sourcesUpsertSql } from "../worker/sync/sqlgen";
import { REGISTRY } from "../worker/registry.generated";

// ---------- 常量 / 环境 ----------

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DB = "juya-daily";

// ARCHIVE_URL / MD_BASE 与 worker 运行时同源：从 wrangler.jsonc vars 读取，缺省回退 spec 值。
function varFromWranglerConfig(key: string, fallback: string): string {
  try {
    const text = readFileSync(path.join(ROOT, "wrangler.jsonc"), "utf8");
    const m = new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`).exec(text);
    if (m) return m[1];
  } catch {
    // 读不到配置时用 spec 默认值
  }
  return fallback;
}

const ARCHIVE_URL = varFromWranglerConfig("ARCHIVE_URL", "https://daily.juya.uk/archive/");
const MD_BASE = varFromWranglerConfig("MD_BASE", "https://daily.juya.uk/markdown");
const CONCURRENCY = 3;
const FETCH_TIMEOUT_MS = 30_000;

interface FetchedIssue {
  date: string; // parseIssue 从标题行取出的期日期
  markdown: string;
  items: Item[];
}

// ---------- fetch 与并发 ----------

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": "juya-daily-backfill/1.0 (local D1 backfill; zero-login)" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// 固定并发池：按 next++ 依序领取，结果按下标回填，保持与输入同序。
async function mapPool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

// 单期抓取 + 解析；失败重试 1 次（网络或解析失败均计），仍失败则抛给调用方记录。
async function fetchIssue(date: string): Promise<FetchedIssue> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const markdown = await fetchText(`${MD_BASE}/${date}.md`);
      const parsed = parseIssue(markdown); // 无日期标题 → 抛错，计为该期失败
      return { date: parsed.date, markdown, items: parsed.items };
    } catch (err) {
      lastError = err;
      if (attempt === 1) await sleep(800);
    }
  }
  throw lastError;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------- wrangler 执行 ----------

interface WranglerResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

// 本地零登录执行 wrangler CLI：优先直跑本地 bin（node + wrangler.js，无 shell 转义歧义），
// 缺失时回退 `npx wrangler`（shell）。等价于 spec 的 `npx wrangler d1 execute --local`。
function runWrangler(args: string[]): WranglerResult {
  const env = { ...process.env, WRANGLER_SEND_METRICS: "false" };
  const localBin = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
  if (existsSync(localBin)) {
    const r = spawnSync(process.execPath, [localBin, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
      env,
    });
    return { ok: r.status === 0, stdout: r.stdout ?? "", stderr: r.stderr ?? String(r.error ?? "") };
  }
  const shellArg = (a: string): string => (/\s/.test(a) ? `"${a}"` : a);
  const r = spawnSync(["npx", "wrangler", ...args.map(shellArg)].join(" "), {
    cwd: ROOT,
    shell: true,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    env,
  });
  return { ok: r.status === 0, stdout: r.stdout ?? "", stderr: r.stderr ?? String(r.error ?? "") };
}

// wrangler --json 输出可能混有横幅行：取首个 `[` 到最后一个 `]` 之间解析。
function parseWranglerJson(stdout: string): unknown {
  const start = stdout.indexOf("[");
  const end = stdout.lastIndexOf("]");
  if (start < 0 || end <= start) {
    throw new Error(`wrangler --json 输出无法解析：${stdout.slice(0, 300)}`);
  }
  return JSON.parse(stdout.slice(start, end + 1));
}

interface Counts {
  sources: number;
  items: number;
  companies: number;
}

function queryCounts(): Counts {
  const sql =
    "SELECT (SELECT COUNT(*) FROM sources) AS sources, " +
    "(SELECT COUNT(*) FROM items) AS items, " +
    "(SELECT COUNT(*) FROM companies) AS companies;";
  const r = runWrangler(["d1", "execute", DB, "--local", "--command", sql, "--json"]);
  if (!r.ok) throw new Error(`counts 查询失败：${r.stderr.slice(-400)}`);
  const arr = parseWranglerJson(r.stdout) as Array<{ results?: Array<Record<string, unknown>> }>;
  const row = arr[0]?.results?.[0] ?? {};
  return {
    sources: Number(row.sources),
    items: Number(row.items),
    companies: Number(row.companies),
  };
}

// ---------- 降级分块 ----------

// 整文件执行失败 → 逐期分块（companies 一块 + 每期一块），打印成功/失败分块，不中断。
function executePerChunk(companiesSql: string, issues: FetchedIssue[]): string[] {
  const chunks: { label: string; sql: string }[] = [];
  if (companiesSql !== "") chunks.push({ label: "companies", sql: companiesSql });
  for (const issue of issues) {
    const sql = [sourcesUpsertSql(issue.date, issue.markdown), itemsUpsertSql(issue.items)]
      .filter((s) => s !== "")
      .join("\n");
    if (sql !== "") chunks.push({ label: issue.date, sql });
  }

  const failed: string[] = [];
  const chunkDir = path.join(ROOT, ".wrangler");
  for (const chunk of chunks) {
    const chunkPath = path.join(chunkDir, `tmp-backfill-chunk-${Date.now()}.sql`);
    writeFileSync(chunkPath, chunk.sql + "\n", "utf8");
    const r = runWrangler(["d1", "execute", DB, "--local", "--file", path.relative(ROOT, chunkPath)]);
    rmSync(chunkPath, { force: true });
    console.log(`  chunk ${chunk.label}: ${r.ok ? "成功" : "失败"}`);
    if (!r.ok) failed.push(chunk.label);
  }
  return failed;
}

// ---------- 主流程 ----------

async function main(): Promise<void> {
  console.log(`== backfill 开始（${new Date().toISOString()}，全程 --local 零登录）`);

  // 1) archive → 期日期列表
  const dates = parseArchiveDates(await fetchText(ARCHIVE_URL));
  if (dates.length === 0) {
    console.error("archive 页未解析到任何期日期，中止");
    process.exitCode = 1;
    return;
  }
  console.log(`archive 期数: ${dates.length}（最新 ${dates[0]}）`);

  // 2) 并发 3 抓取 + 解析；单期失败重试 1 次仍失败 → 记录并继续
  const failures: { date: string; error: string }[] = [];
  const fetched = await mapPool(dates, CONCURRENCY, async (date) => {
    try {
      return await fetchIssue(date);
    } catch (err) {
      failures.push({ date, error: errorMessage(err) });
      return null;
    }
  });
  const issues = fetched.filter((x): x is FetchedIssue => x !== null);
  console.log(`成功抓取期数: ${issues.length}/${dates.length}`);
  for (const f of failures) console.log(`  失败: ${f.date} — ${f.error}`);

  // 3) SQL 累积：companies 一次 + 每期 sources + items（全部 upsert，天然幂等）
  const statements: string[] = [];
  const companiesSql = companiesUpsertSql(REGISTRY);
  if (companiesSql !== "") statements.push(companiesSql);
  for (const issue of issues) {
    const sourceSql = sourcesUpsertSql(issue.date, issue.markdown);
    if (sourceSql !== "") statements.push(sourceSql);
    const itemSql = itemsUpsertSql(issue.items);
    if (itemSql !== "") statements.push(itemSql);
  }

  // 4) 临时 SQL 文件 → wrangler d1 execute --local --file → 成功后删除；失败降级分块
  mkdirSync(path.join(ROOT, ".wrangler"), { recursive: true });
  const tmpPath = path.join(ROOT, ".wrangler", `tmp-backfill-${Date.now()}.sql`);
  writeFileSync(tmpPath, statements.join("\n") + "\n", "utf8");
  console.log(`SQL 文件: ${path.relative(ROOT, tmpPath)}（${statements.length} 条语句）`);

  const relTmp = path.relative(ROOT, tmpPath);
  const whole = runWrangler(["d1", "execute", DB, "--local", "--file", relTmp]);
  let chunkFailures: string[] = [];
  if (whole.ok) {
    console.log("整文件执行成功");
  } else {
    console.error("整文件执行失败，降级为逐期分块执行：");
    console.error(whole.stderr.split(/\r?\n/).slice(-8).join("\n"));
    chunkFailures = executePerChunk(companiesSql, issues);
  }
  rmSync(tmpPath, { force: true }); // 成功后删临时文件（失败路径亦清理，.wrangler gitignored）

  // 5) counts 打印（经 wrangler --json 查询）
  const counts = queryCounts();
  console.log("== backfill 摘要 ==");
  console.log(`archive 期数: ${dates.length}`);
  console.log(`成功抓取期数: ${issues.length}`);
  console.log(`失败清单: ${failures.length === 0 ? "（无）" : failures.map((f) => f.date).join(", ")}`);
  console.log(`失败分块: ${chunkFailures.length === 0 ? "（无）" : chunkFailures.join(", ")}`);
  console.log(`sources 行数: ${counts.sources}`);
  console.log(`items 行数: ${counts.items}`);
  console.log(`companies 行数: ${counts.companies}`);

  if (failures.length > 0 || chunkFailures.length > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(`backfill 失败: ${errorMessage(err)}`);
  process.exitCode = 1;
});

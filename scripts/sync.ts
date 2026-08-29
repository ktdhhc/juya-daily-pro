// sync — spec05 Step 3：手动增量同步 I/O 胶水（npm run sync）。
// 流程：registry 镜像刷新（companiesUpsertSql(REGISTRY) + companiesPruneSql，spec06 契约扩展 3，每次运行）
// → 查 max(items.date) → fetch archive → selectSyncDates 窗口（worker/sync/pipeline.ts）
// → 并发 3 抓新期（单期重试 1 次）→ parseIssue → matchAll（读 D1 companies，worker/sync/match.ts）
// → SQL 累积：sources/items/item_companies/enrich_state + 每期 syncLogUpsertSql(该期, 'ok', "")
// → 临时 SQL 文件 → `wrangler d1 execute juya-daily --local --file` → 删除 → counts + sync_log 尾部打印。
// 失败期（fetch/parse 抛错）不入数据 SQL，改写 syncLogUpsertSql(期, 'fetch_failed'|'parse_failed', 错误消息)，
// 不阻塞后续期（ADR-0008）；结束有失败 → 退出码 1。
// `--dates=a,b` 强制指定期次（补拉与 404 演练），跳过窗口计算。
// 全程零 Cloudflare 登录（仅 --local）、零 LLM。
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { REGISTRY } from "../src/lib/registry.generated";
import type { Company, Item } from "../src/lib/schema";
import { parseArchiveDates } from "../worker/sync/archive";
import { matchAll } from "../worker/sync/match";
import { parseIssue } from "../worker/sync/parse";
import { selectSyncDates } from "../worker/sync/pipeline";
import {
  companiesPruneSql,
  companiesUpsertSql,
  enrichStateUpdateSql,
  itemCompaniesUpsertSql,
  itemsUpsertSql,
  sourcesUpsertSql,
  syncLogUpsertSql,
} from "../worker/sync/sqlgen";
import { parseWranglerJson, runWrangler, varFromWranglerConfig } from "./lib/wrangler-cli";

// ---------- 常量 / 环境 ----------

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DB = "juya-daily";

const ARCHIVE_URL = varFromWranglerConfig("ARCHIVE_URL", "https://daily.juya.uk/archive/");
const MD_BASE = varFromWranglerConfig("MD_BASE", "https://daily.juya.uk/markdown");
const lookbackRaw = Number(varFromWranglerConfig("SYNC_LOOKBACK_DAYS", "3"));
const LOOKBACK_DAYS = Number.isFinite(lookbackRaw) && lookbackRaw >= 0 ? lookbackRaw : 3;
const CONCURRENCY = 3;
const FETCH_TIMEOUT_MS = 30_000;

// ---------- fetch 与并发（与 backfill.ts 同构） ----------

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": "juya-daily-sync/1.0 (manual incremental sync; zero-login)" },
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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------- 单期抓取 + 解析（失败分类：ADR-0008） ----------

export type IssueOutcome =
  | { date: string; ok: true; parsedDate: string; markdown: string; items: Item[] }
  | { date: string; ok: false; status: "fetch_failed" | "parse_failed"; error: string };

// fetch 失败重试 1 次；parse 失败是确定性失败不重试（同一输入必然同样抛错）。
async function fetchOneIssue(date: string): Promise<IssueOutcome> {
  let lastFetchError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const markdown = await fetchText(`${MD_BASE}/${date}.md`);
      try {
        const parsed = parseIssue(markdown); // 无日期标题 → 抛错
        return { date, ok: true, parsedDate: parsed.date, markdown, items: parsed.items };
      } catch (err) {
        return { date, ok: false, status: "parse_failed", error: errorMessage(err) };
      }
    } catch (err) {
      lastFetchError = errorMessage(err);
      if (attempt === 1) await sleep(800);
    }
  }
  return { date, ok: false, status: "fetch_failed", error: lastFetchError };
}

// ---------- D1 读取 / 写入 ----------

function queryScalar(sql: string, label: string): unknown {
  const r = runWrangler(["d1", "execute", DB, "--local", "--command", sql, "--json"]);
  if (!r.ok) throw new Error(`${label} 查询失败：${r.stderr.slice(-400)}`);
  const arr = parseWranglerJson(r.stdout) as Array<{ results?: Array<Record<string, unknown>> }>;
  return arr[0]?.results?.[0];
}

function queryMaxItemDate(): string | null {
  const row = queryScalar("SELECT MAX(date) AS m FROM items;", "max(items.date)") as
    | { m: string | null }
    | undefined;
  return row?.m ?? null;
}

interface CompanyRow {
  id: string;
  name: string;
  aliases: string; // JSON 字符串
  color: string;
  status: string;
  notes: string;
}

function queryCompanies(): Company[] {
  const r = runWrangler([
    "d1", "execute", DB, "--local", "--command",
    "SELECT id, name, aliases, color, status, notes FROM companies ORDER BY id;", "--json",
  ]);
  if (!r.ok) throw new Error(`companies 查询失败：${r.stderr.slice(-400)}`);
  const arr = parseWranglerJson(r.stdout) as Array<{ results?: CompanyRow[] }>;
  return (arr[0]?.results ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    aliases: JSON.parse(c.aliases) as string[],
    color: c.color,
    status: c.status as Company["status"],
    notes: c.notes,
  }));
}

interface Counts {
  sources: number;
  items: number;
  companies: number;
  item_companies: number;
}

// SQL 累积 → 临时文件 → wrangler d1 execute --local --file → 删除（成功失败均清理，.wrangler gitignored）。
// 失败不抛出：置退出码后由调用方继续（counts 打印 / 后续步骤），退出码语义同 backfill。
function executeSqlFile(statements: string[], label: string): void {
  mkdirSync(path.join(ROOT, ".wrangler"), { recursive: true });
  const tmpPath = path.join(ROOT, ".wrangler", `tmp-sync-${label}-${Date.now()}.sql`);
  writeFileSync(tmpPath, statements.filter((s) => s !== "").join("\n") + "\n", "utf8");
  console.log(`SQL 文件: ${path.relative(ROOT, tmpPath)}（${label}，${statements.length} 条语句）`);
  const r = runWrangler(["d1", "execute", DB, "--local", "--file", path.relative(ROOT, tmpPath)]);
  rmSync(tmpPath, { force: true });
  if (!r.ok) {
    console.error("SQL 执行失败：");
    console.error(r.stderr.split(/\r?\n/).slice(-8).join("\n"));
    process.exitCode = 1;
  } else {
    console.log("SQL 执行成功");
  }
}

function queryCounts(): Counts {
  const sql =
    "SELECT (SELECT COUNT(*) FROM sources) AS sources, " +
    "(SELECT COUNT(*) FROM items) AS items, " +
    "(SELECT COUNT(*) FROM companies) AS companies, " +
    "(SELECT COUNT(*) FROM item_companies) AS item_companies;";
  const row = queryScalar(sql, "counts") as Record<string, unknown> | undefined;
  return {
    sources: Number(row?.sources),
    items: Number(row?.items),
    companies: Number(row?.companies),
    item_companies: Number(row?.item_companies),
  };
}

// sync_log 尾部（spec05 3.5 核验口径：attempted_at 倒序 6 行）
function printSyncLogTail(): void {
  const sql =
    "SELECT date, status, substr(error_message,1,40) AS error_message " +
    "FROM sync_log ORDER BY attempted_at DESC LIMIT 6;";
  const r = runWrangler(["d1", "execute", DB, "--local", "--command", sql, "--json"]);
  if (!r.ok) {
    console.error(`sync_log 查询失败：${r.stderr.slice(-400)}`);
    return;
  }
  const arr = parseWranglerJson(r.stdout) as Array<{
    results?: Array<{ date: string; status: string; error_message: string | null }>;
  }>;
  const rows = arr[0]?.results ?? [];
  console.log("sync_log 尾部（attempted_at 倒序 6 行）:");
  for (const row of rows) {
    console.log(`  ${row.date}  ${row.status}  ${row.error_message ?? "NULL"}`);
  }
}

// ---------- 参数 ----------

// `--dates=a,b` → 期次列表（去重 + 升序）；未提供 → null（走窗口计算）。
function parseDatesArg(argv: string[]): string[] | null {
  for (const a of argv) {
    const m = /^--dates=(.+)$/.exec(a);
    if (m) {
      const dates = m[1].split(",").map((s) => s.trim()).filter((s) => s !== "");
      return [...new Set(dates)].sort();
    }
  }
  return null;
}

// ---------- 主流程 ----------

async function main(): Promise<void> {
  const datesArg = parseDatesArg(process.argv.slice(2));
  console.log(`== sync 开始（${new Date().toISOString()}，全程 --local 零登录）`);
  console.log(`vars: ARCHIVE_URL=${ARCHIVE_URL} MD_BASE=${MD_BASE} SYNC_LOOKBACK_DAYS=${LOOKBACK_DAYS}`);

  // 0) registry 镜像刷新（spec06 契约扩展 3 + A4）：upsert 当前 yaml registry → prune 已移除 id。
  //    每次运行都执行（无窗口期亦然）；先于 companies 读取，保证本次匹配读到的是当前镜像。
  const registryIds = REGISTRY.map((c) => c.id);
  console.log(`registry 镜像刷新: upsert ${REGISTRY.length} 家 + prune（activeIds ${registryIds.length}）`);
  executeSqlFile([companiesUpsertSql(REGISTRY), companiesPruneSql(registryIds)], "mirror");

  // 1) 确定窗口期次：--dates 强制 / max(items.date) + lookback 窗口
  let dates: string[];
  if (datesArg !== null) {
    dates = datesArg;
    console.log(`--dates 强制期次: ${dates.join(", ")}`);
  } else {
    const maxItemDate = queryMaxItemDate();
    console.log(`max(items.date): ${maxItemDate ?? "（空库）"}`);
    const archiveDates = parseArchiveDates(await fetchText(ARCHIVE_URL));
    if (archiveDates.length === 0) {
      console.error("archive 页未解析到任何期日期，中止");
      process.exitCode = 1;
      return;
    }
    console.log(`archive 期数: ${archiveDates.length}（最新 ${archiveDates[0]}）`);
    dates = selectSyncDates(archiveDates, maxItemDate, LOOKBACK_DAYS);
    console.log(`同步窗口: ${dates.length === 0 ? "（无新期）" : dates.join(", ")}`);
  }

  const failures: { date: string; status: string; error: string }[] = [];

  if (dates.length > 0) {
    // 2) companies → 段一匹配 registry（D1 镜像，match-all 同源）
    const registry = queryCompanies();
    console.log(`companies 读取: ${registry.length} 行`);

    // 3) 并发 3 抓取 + 解析（结果与输入同序 = 升序执行序）
    const outcomes = await mapPool(dates, CONCURRENCY, fetchOneIssue);

    // 4) SQL 累积：成功期五件套；失败期仅 sync_log（fetch_failed/parse_failed），不阻塞后续期
    const statements: string[] = [];
    for (const o of outcomes) {
      if (!o.ok) {
        failures.push({ date: o.date, status: o.status, error: o.error });
        console.log(`  失败: ${o.date} — ${o.status} — ${o.error}`);
        statements.push(syncLogUpsertSql(o.date, o.status, o.error));
        continue;
      }
      const { ownerRows, okIds, missingIds } = matchAll(o.items, registry);
      statements.push(
        sourcesUpsertSql(o.parsedDate, o.markdown),
        itemsUpsertSql(o.items),
        itemCompaniesUpsertSql(ownerRows),
        enrichStateUpdateSql(okIds, missingIds),
        syncLogUpsertSql(o.date, "ok", ""),
      );
    }

    // 5) 临时 SQL 文件 → wrangler d1 execute --local --file → 删除
    executeSqlFile(statements, "data");
  }

  // 6) counts + sync_log 尾部打印
  const counts = queryCounts();
  console.log("== sync 摘要 ==");
  console.log(`窗口期次: ${dates.length}`);
  console.log(`成功期次: ${dates.length - failures.length}`);
  console.log(
    `失败清单: ${failures.length === 0 ? "（无）" : failures.map((f) => `${f.date}(${f.status})`).join(", ")}`,
  );
  console.log(`sources 行数: ${counts.sources}`);
  console.log(`items 行数: ${counts.items}`);
  console.log(`companies 行数: ${counts.companies}`);
  console.log(`item_companies 行数: ${counts.item_companies}`);
  printSyncLogTail();

  if (failures.length > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(`sync 失败: ${errorMessage(err)}`);
  process.exitCode = 1;
});

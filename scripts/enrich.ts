// enrich — spec09 Step 2.3：多家命中条目（item_companies ≥2）的 LLM 归属裁决回填（存量数据离线批跑）。
// 流程：loadLlmConfig → wrangler --local 读 D1（多家命中条目 item_id 升序 + title/body + 候选）
// → 跳过已有 enrich_cache（--force 重算）→ MAX_LLM_PER_RUN 限流（wrangler.jsonc vars 默认 20，
// --max= 覆盖；--limit=N 圈前 N 条待裁决条目）→ chatJson 裁决 → 纯函数 parse/derive
// → 逐 item 写库（enrich_cache upsert + item_companies role 回写，COALESCE 防清摆）→ 报告。
// 纯逻辑在 src/lib/llm/enrich.ts / enrich-sql.ts；本脚本只做 IO 胶水（ADR-0014：不进同步关键路径）。
// 纪律：任何路径都不打印配置值（含 key）。
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Company } from "../src/lib/schema";
import {
  buildEnrichPrompt,
  deriveRoles,
  parseEnrichResponse,
  type EnrichCandidate,
  type EnrichItem,
  type EnrichVerdict,
} from "../src/lib/llm/enrich";
import { enrichApplySql } from "../src/lib/llm/enrich-sql";
import { matchCandidates } from "../src/lib/matchCompanies";
import { escapeSqlText } from "../worker/sync/sqlgen";
import { chatJson, loadLlmConfig, runWithLimiter } from "./lib/llm";
import { parseWranglerJson, runWrangler, varFromWranglerConfig } from "./lib/wrangler-cli";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DB = "juya-daily";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const sqlQuote = (s: string): string => `'${escapeSqlText(s)}'`;

// ---------- 参数 ----------

interface Args {
  limit?: number; // --limit=N：只处理前 N 条待裁决条目
  max?: number; // --max=N：覆盖 MAX_LLM_PER_RUN（单次运行 LLM 调用上限）
  force: boolean; // --force：已有 enrich_cache 也重算
}

function parseArgs(argv: string[]): Args {
  const args: Args = { force: false };
  for (const a of argv) {
    if (a === "--force") args.force = true;
    else if (a.startsWith("--limit=")) args.limit = Number(a.slice("--limit=".length));
    else if (a.startsWith("--max=")) args.max = Number(a.slice("--max=".length));
  }
  return args;
}

// ---------- D1 读取 ----------

interface MultiRow {
  item_id: string;
  c: number;
}
interface ItemRow {
  id: string;
  title: string;
  summary: string;
  body_md: string;
}
interface CandRow {
  item_id: string;
  company_id: string;
}
interface CompanyRow {
  id: string;
  name: string;
  aliases: string; // JSON 字符串
  color: string;
  status: string;
  notes: string;
}

function queryRows<T>(sql: string, label: string): T[] {
  const r = runWrangler(["d1", "execute", DB, "--local", "--command", sql, "--json"]);
  if (!r.ok) throw new Error(`${label} 查询失败：${r.stderr.slice(-400)}`);
  const arr = parseWranglerJson(r.stdout) as Array<{ results?: T[] }>;
  return arr[0]?.results ?? [];
}

// ---------- 主流程 ----------

interface BatchEntry {
  id: string;
  item: EnrichItem;
  candidates: EnrichCandidate[];
}

interface JobResult {
  entry: BatchEntry;
  ok: boolean;
  verdicts?: EnrichVerdict[];
  error?: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadLlmConfig(); // 缺 key 报错退出（消息含「检查 .env」，不打印值）
  const maxRaw = args.max ?? Number(varFromWranglerConfig("MAX_LLM_PER_RUN", "20"));
  const maxLlm = Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : 20;

  console.log(
    `== enrich 开始（${new Date().toISOString()}，--local 零登录；单次 LLM 调用上限 ${maxLlm}` +
      `${args.limit !== undefined ? `，--limit=${args.limit}` : ""}${args.force ? "，--force" : ""}）`,
  );

  // 1) 多家命中条目（item_companies 计数 ≥2），item_id 升序
  const multiRows = queryRows<MultiRow>(
    "SELECT item_id, COUNT(*) AS c FROM item_companies GROUP BY item_id HAVING COUNT(*) >= 2 ORDER BY item_id;",
    "多家命中条目",
  );
  const multiIds = multiRows.map((r) => r.item_id);

  // 2) 已缓存跳过（--force 重算）；limit/max 圈定本次批
  const cachedRows = queryRows<{ item_id: string }>("SELECT item_id FROM enrich_cache;", "enrich_cache");
  const cached = new Set(cachedRows.map((r) => r.item_id));
  const pendingIds = args.force ? multiIds : multiIds.filter((id) => !cached.has(id));
  const skipped = multiIds.length - pendingIds.length;
  const count = Math.min(pendingIds.length, args.limit ?? maxLlm, maxLlm);
  const batchIds = pendingIds.slice(0, count);
  console.log(`多家命中条目: ${multiIds.length}｜已缓存跳过: ${skipped}｜本次圈定: ${batchIds.length}`);
  if (batchIds.length === 0) {
    console.log("无待裁决条目，结束");
    return;
  }

  // 3) 条目材料 + 候选（item_companies ⋈ companies），命中别名证据按 title/body 对 aliases 重扫
  const idList = batchIds.map(sqlQuote).join(", ");
  const itemRows = queryRows<ItemRow>(
    `SELECT id, title, summary, body_md FROM items WHERE id IN (${idList});`,
    "items",
  );
  const candRows = queryRows<CandRow>(
    `SELECT item_id, company_id FROM item_companies WHERE item_id IN (${idList}) ORDER BY item_id, company_id;`,
    "候选归属",
  );
  const companyRows = queryRows<CompanyRow>(
    "SELECT id, name, aliases, color, status, notes FROM companies ORDER BY id;",
    "companies",
  );
  const registry: Company[] = companyRows.map((c) => ({
    id: c.id,
    name: c.name,
    aliases: JSON.parse(c.aliases) as string[],
    color: c.color,
    status: c.status as Company["status"],
    notes: c.notes,
  }));
  const registryById = new Map(registry.map((c) => [c.id, c]));
  const itemById = new Map(itemRows.map((r) => [r.id, r]));
  const candIdsByItem = new Map<string, string[]>();
  for (const r of candRows) {
    const ids = candIdsByItem.get(r.item_id) ?? [];
    ids.push(r.company_id);
    candIdsByItem.set(r.item_id, ids);
  }

  const entries: BatchEntry[] = batchIds.flatMap((id) => {
    const row = itemById.get(id);
    const candIds = candIdsByItem.get(id) ?? [];
    if (row === undefined || candIds.length === 0) return []; // 数据不一致条目：跳过，余量报告兜底
    const candCompanies = candIds
      .map((cid) => registryById.get(cid))
      .filter((c): c is Company => c !== undefined);
    const hits = matchCandidates({ title: row.title, bodyMd: row.body_md }, candCompanies);
    const evidenceById = new Map(hits.map((h) => [h.companyId, h.matchedAliases]));
    const candidates: EnrichCandidate[] = candIds.map((cid) => {
      const c = registryById.get(cid);
      return {
        id: cid,
        name: c?.name ?? cid,
        notes: c?.notes ?? "",
        evidence: evidenceById.get(cid) ?? [],
      };
    });
    return [
      {
        id,
        item: { title: row.title, summary: row.summary, bodyMd: row.body_md },
        candidates,
      },
    ];
  });

  // 4) LLM 裁决（固定并发池；单条失败兜底记录，不中断整批）
  const results = await runWithLimiter(
    entries.map(
      (entry): (() => Promise<JobResult>) =>
        async () => {
          try {
            const prompt = buildEnrichPrompt(entry.item, entry.candidates);
            const raw = await chatJson(cfg, prompt.system, prompt.user);
            const candidateIds = entry.candidates.map((c) => c.id);
            const parsed = parseEnrichResponse(raw, candidateIds);
            if (parsed === null) {
              return { entry, ok: false, error: `响应不合法（前 120 字符）：${raw.slice(0, 120)}` };
            }
            const verdicts = deriveRoles(entry.item, entry.candidates, parsed.primaryId, parsed.reason);
            return { entry, ok: true, verdicts };
          } catch (err) {
            return { entry, ok: false, error: errorMessage(err) };
          }
        },
    ),
    maxLlm,
  );

  // 5) 逐 item 写库：enrich_cache upsert + item_companies role 回写（单语句单行，临时 SQL 文件）
  const successLines: string[] = [];
  const failureLines: string[] = [];
  const runRoleCounts = new Map<string, number>();
  mkdirSync(path.join(ROOT, ".wrangler"), { recursive: true });
  for (const r of results) {
    if (!r.ok || r.verdicts === undefined) {
      failureLines.push(`${r.entry.id} — ${r.error ?? "未知错误"}`);
      continue;
    }
    const tmpPath = path.join(ROOT, ".wrangler", `tmp-enrich-${r.entry.id}-${Date.now()}.sql`);
    writeFileSync(tmpPath, enrichApplySql(r.entry.id, r.verdicts, cfg.model) + "\n", "utf8");
    const w = runWrangler(["d1", "execute", DB, "--local", "--file", path.relative(ROOT, tmpPath)]);
    rmSync(tmpPath, { force: true });
    if (!w.ok) {
      failureLines.push(
        `${r.entry.id} — 写库失败：${w.stderr.split(/\r?\n/).filter((l) => l.trim() !== "").slice(-1).join(" ")}`,
      );
      continue;
    }
    const primary = r.verdicts.find((v) => v.role === "primary");
    const others = r.verdicts
      .filter((v) => v.role !== "primary")
      .map((v) => `${v.companyId}=${v.role}`)
      .join("；");
    successLines.push(
      `${r.entry.id} → primary=${primary?.companyId ?? "（无）"}（${primary?.reason ?? ""}）｜${others}`,
    );
    for (const v of r.verdicts) runRoleCounts.set(v.role, (runRoleCounts.get(v.role) ?? 0) + 1);
  }

  // 6) 全表 role 分布 + 未处理余量（跑完后仍无 enrich_cache 的多家命中条目）
  const distRows = queryRows<{ role: string | null; c: number }>(
    "SELECT role, COUNT(*) AS c FROM item_companies GROUP BY role ORDER BY role;",
    "role 分布",
  );
  const cacheAfter = new Set(
    queryRows<{ item_id: string }>("SELECT item_id FROM enrich_cache;", "enrich_cache").map(
      (r) => r.item_id,
    ),
  );
  const remaining = multiIds.filter((id) => !cacheAfter.has(id)).length;

  // ---------- 报告 ----------
  console.log("== enrich 摘要 ==");
  console.log(`成功 ${successLines.length}｜失败 ${failureLines.length}｜已缓存跳过 ${skipped}｜未处理余量 ${remaining}`);
  console.log("成功明细（reason 人工可读）:");
  for (const line of successLines) console.log(`  ${line}`);
  console.log(`失败清单: ${failureLines.length === 0 ? "（无）" : ""}`);
  for (const line of failureLines) console.log(`  ${line}`);
  const runDist = ["primary", "partner", "subject"]
    .map((role) => `${role}=${runRoleCounts.get(role) ?? 0}`)
    .join("，");
  console.log(`role 分布（本次写入）: ${runDist}`);
  console.log(
    `role 分布（全表 item_companies）: ${distRows
      .map((r) => `${r.role ?? "NULL"}=${r.c}`)
      .join("，")}`,
  );

  if (failureLines.length > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(`enrich 失败: ${errorMessage(err)}`);
  process.exitCode = 1;
});

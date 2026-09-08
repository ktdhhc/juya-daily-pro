// propose-companies — spec09 Step 3.2/3.3：missing_owner 条目的 LLM 候选公司提议（存量数据离线批跑）。
// 流程：loadLlmConfig → wrangler 读 D1（目标缺省 --local 零登录，--remote 连远端；missing_owner 条目 id 升序 + 在册公司名清单）
// → runWithLimiter 逐条三分类判别（company / product / ignore）→ 不直接入册：
// company 建议按 id 去重合并（同 id 保留 evidence 最多 3 条）追加写 data/companies-pending.yaml
// → 报告（company/product/ignore 分布 + 建议清单 + product 清单 + 失败清单）。
// 红线：LLM 永不直接改白名单——本脚本绝不写 data/companies.yaml / src/lib/registry.generated.ts，
// 认可 pending 条目后由人工搬入 companies.yaml → gen:registry → sync + match:all。
// 纯逻辑在 src/lib/llm/propose.ts；本脚本只做 IO 胶水（ADR-0014：不进同步关键路径）。
// 纪律：任何路径都不打印配置值（含 key）。
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  buildProposePrompt,
  parseProposeResponse,
  type ProposeVerdict,
} from "../src/lib/llm/propose";
import { chatJson, loadLlmConfig, runWithLimiter } from "./lib/llm";
import { parseDbTarget, parseWranglerJson, runWrangler, varFromWranglerConfig } from "./lib/wrangler-cli";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DB = "juya-daily";
// 数据库目标（spec15 缝 1）：缺省 --local 零登录；显式 --remote 连远端。
const DB_TARGET = parseDbTarget(process.argv.slice(2));
const PENDING_PATH = path.join(ROOT, "data", "companies-pending.yaml");

// ---------- confidence 三档规则（简单启发，依据证据强度——是否含域名/官方产品名） ----------
// - high：evidence 含域名串（形如 example.com / xxx.ai），或 LLM 给出了 name 之外的别名
//   （官方产品名/别名字面在场的信号）；
// - mid：evidence 明确点名建议 name 字面（大小写不敏感），但无域名/别名佐证；
// - low：其余（证据笼统，如仅"是一家 AI 公司"式泛述）。
type Confidence = "high" | "mid" | "low";
function confidenceOf(name: string, aliases: string[], evidence: string): Confidence {
  if (/[a-z0-9-]+\.[a-z]{2,}/i.test(evidence)) return "high";
  if (aliases.some((a) => a.toLowerCase() !== name.toLowerCase())) return "high";
  if (evidence.toLowerCase().includes(name.toLowerCase())) return "mid";
  return "low";
}

// ---------- 参数 ----------

interface Args {
  limit?: number; // --limit=N：只处理前 N 条 missing_owner 条目（默认 40/轮）
  max?: number; // --max=N：覆盖 MAX_LLM_PER_RUN（单次运行 LLM 并发上限）
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (const a of argv) {
    if (a.startsWith("--limit=")) args.limit = Number(a.slice("--limit=".length));
    else if (a.startsWith("--max=")) args.max = Number(a.slice("--max=".length));
  }
  return args;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------- D1 读取 ----------

interface ItemRow {
  id: string;
  title: string;
  summary: string;
  body_md: string;
}

function queryRows<T>(sql: string, label: string): T[] {
  const r = runWrangler(["d1", "execute", DB, DB_TARGET, "--command", sql, "--json"]);
  if (!r.ok) throw new Error(`${label} 查询失败：${r.stderr.slice(-400)}`);
  const arr = parseWranglerJson(r.stdout) as Array<{ results?: T[] }>;
  return arr[0]?.results ?? [];
}

// ---------- pending 合并（按建议 id 去重，同 id 保留 evidence 最多 3 条） ----------

// pending 条目内部形态；写文件时 evidences join 成 reason 单行（键序 id/name/aliases/confidence/reason/source）
interface Draft {
  id: string;
  name: string;
  aliases: string[];
  confidence: Confidence;
  source: string; // 首个触发提议的 item id（合并时保留，不覆盖）
  evidences: string[]; // ≤3 段，写入时以 EVIDENCE_SEP 连接为 reason
}

const EVIDENCE_SEP = "；";
const EVIDENCE_MAX = 3;

// evidence 规整为单行（换行/连续空白折叠），保证 YAML reason 单行可写
const normEvidence = (s: string): string => s.replace(/\s+/g, " ").trim();

function splitReason(reason: string): string[] {
  return reason
    .split(EVIDENCE_SEP)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

// 读入已存在的 pending 文件（不存在 / 结构不含 candidates 数组 → 空清单，从零开始）
function readExistingDrafts(): Draft[] {
  if (!existsSync(PENDING_PATH)) return [];
  const doc = parseYaml(readFileSync(PENDING_PATH, "utf8")) as { candidates?: unknown } | null;
  if (!Array.isArray(doc?.candidates)) return [];
  const drafts: Draft[] = [];
  for (const raw of doc.candidates) {
    if (typeof raw !== "object" || raw === null) continue;
    const c = raw as Record<string, unknown>;
    if (
      typeof c.id !== "string" ||
      typeof c.name !== "string" ||
      typeof c.reason !== "string" ||
      typeof c.source !== "string" ||
      (c.confidence !== "high" && c.confidence !== "mid" && c.confidence !== "low") ||
      (c.aliases !== undefined && !Array.isArray(c.aliases))
    ) {
      continue; // 形态不符的旧条目：跳过不覆盖，不中断本轮
    }
    drafts.push({
      id: c.id,
      name: c.name,
      aliases: c.aliases === undefined ? [] : (c.aliases as string[]),
      confidence: c.confidence,
      source: c.source,
      evidences: splitReason(c.reason),
    });
  }
  return drafts;
}

// ---------- YAML 手工拼装（字符串一律单引号包裹、内部单引号翻倍转义） ----------

const yq = (s: string): string => `'${s.replace(/'/g, "''")}'`;

function renderPendingYaml(drafts: Draft[]): string {
  const lines: string[] = [
    "# companies-pending — LLM 提议候选（npm run propose:companies 产出，spec09 Step 3）。LLM 永不直接改白名单。",
    "# 人工流程：审核本文件 → 认可条目手工搬入 data/companies.yaml（补 domain/color/status/notes）",
    "#   → npm run gen:registry → npm run sync + npm run match:all → missing_owner 下降。",
    "# 脚本按 id 合并去重（同 id 保留 evidence 最多 3 条），source 为首个触发提议的 item id。",
    "candidates:",
  ];
  for (const d of drafts) {
    lines.push(`  - id: ${yq(d.id)}`);
    lines.push(`    name: ${yq(d.name)}`);
    if (d.aliases.length === 0) {
      lines.push("    aliases: []");
    } else {
      lines.push("    aliases:");
      for (const a of d.aliases) lines.push(`      - ${yq(a)}`);
    }
    lines.push(`    confidence: ${yq(d.confidence)}`);
    lines.push(`    reason: ${yq(d.evidences.join(EVIDENCE_SEP))}`);
    lines.push(`    source: ${yq(d.source)}`);
  }
  return lines.join("\n") + "\n";
}

// ---------- 主流程 ----------

interface JobResult {
  itemId: string;
  ok: boolean;
  verdict?: ProposeVerdict;
  error?: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadLlmConfig(); // 缺 key 报错退出（消息含「检查 .env」，不打印值）
  const maxRaw = args.max ?? Number(varFromWranglerConfig("MAX_LLM_PER_RUN", "20"));
  const maxLlm = Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : 20;
  const limitRaw = args.limit ?? 40;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 40;

  console.log(
    `== propose-companies 开始（${new Date().toISOString()}，目标 ${DB_TARGET}；` +
      `--limit=${limit}，并发上限 ${maxLlm}）`,
  );

  // 1) missing_owner 条目（id 升序，--limit 圈批）+ 在册公司名清单
  const countRows = queryRows<{ c: number }>(
    "SELECT COUNT(*) AS c FROM items WHERE enrich_state='missing_owner';",
    "missing_owner 计数",
  );
  const totalMissing = countRows[0]?.c ?? 0;
  const itemRows = queryRows<ItemRow>(
    `SELECT id, title, summary, body_md FROM items WHERE enrich_state='missing_owner' ORDER BY id LIMIT ${limit};`,
    "missing_owner 条目",
  );
  const batch = itemRows.slice(0, limit);
  const registryNames = queryRows<{ name: string }>("SELECT name FROM companies ORDER BY id;", "companies").map(
    (r) => r.name,
  );
  console.log(`missing_owner 总数: ${totalMissing}｜本次圈定: ${batch.length}｜在册公司: ${registryNames.length} 家`);
  if (batch.length === 0) {
    console.log("无 missing_owner 条目，结束（pending 文件未改动）");
    return;
  }

  // 2) LLM 逐条三分类（固定并发池；单条失败兜底记录，不中断整批）
  const results = await runWithLimiter(
    batch.map(
      (row): (() => Promise<JobResult>) =>
        async () => {
          try {
            const prompt = buildProposePrompt(
              { title: row.title, summary: row.summary, bodyMd: row.body_md },
              registryNames,
            );
            const raw = await chatJson(cfg, prompt.system, prompt.user);
            const verdict = parseProposeResponse(raw, registryNames);
            if (verdict === null) {
              return { itemId: row.id, ok: false, error: `响应不合法（前 120 字符）：${raw.slice(0, 120)}` };
            }
            return { itemId: row.id, ok: true, verdict };
          } catch (err) {
            return { itemId: row.id, ok: false, error: errorMessage(err) };
          }
        },
    ),
    maxLlm,
  );

  // 3) 合并 company 建议 → pending（按 id 去重；同 id 追加 evidence 去重后上限 3，旧条目内容不覆盖）
  const existing = readExistingDrafts();
  const merged = new Map<string, Draft>();
  for (const d of existing) merged.set(d.id, { ...d, evidences: [...d.evidences] });
  const counts = { company: 0, product: 0, ignore: 0 };
  const companyLines: string[] = []; // 建议清单（本轮新提议/合并命中）
  const productLines: string[] = []; // 在册公司产品/子品牌（提示可加 alias，不写 pending）
  const failureLines: string[] = [];
  let dirty = false; // 有新增条目或既有条目 evidence 增补时才重写文件
  for (const r of results) {
    if (!r.ok || r.verdict === undefined) {
      failureLines.push(`${r.itemId} — ${r.error ?? "未知错误"}`);
      continue;
    }
    counts[r.verdict.kind] += 1;
    if (r.verdict.kind === "company") {
      const evidence = normEvidence(r.verdict.evidence);
      const hit = merged.get(r.verdict.id);
      if (hit === undefined) {
        merged.set(r.verdict.id, {
          id: r.verdict.id,
          name: r.verdict.name,
          aliases: r.verdict.aliases,
          confidence: confidenceOf(r.verdict.name, r.verdict.aliases, evidence),
          source: r.itemId,
          evidences: [evidence],
        });
        dirty = true;
      } else if (hit.evidences.length < EVIDENCE_MAX && !hit.evidences.includes(evidence)) {
        hit.evidences.push(evidence); // source/name/aliases/confidence 保留旧值（不覆盖旧内容）
        dirty = true;
      }
      companyLines.push(`${r.itemId} → ${r.verdict.id}（${r.verdict.name}）— ${evidence}`);
    } else if (r.verdict.kind === "product") {
      productLines.push(`${r.itemId} → parent=${r.verdict.parent} — ${r.verdict.evidence}`);
    }
  }
  const drafts = [...merged.values()];

  // 4) 写 pending 文件（仅在内容有变化时重写；绝不触碰 companies.yaml / registry.generated.ts）
  let written = false;
  if (dirty) {
    writeFileSync(PENDING_PATH, renderPendingYaml(drafts), "utf8");
    written = true;
  }

  // ---------- 报告 ----------
  console.log("== propose-companies 摘要 ==");
  console.log(
    `判别 ${results.length}｜company ${counts.company}｜product ${counts.product}｜ignore ${counts.ignore}｜失败 ${failureLines.length}`,
  );
  console.log(`missing_owner 余量（本轮未处理）: ${Math.max(totalMissing - results.length, 0)}`);
  console.log("建议清单（company，已合并入 pending）:");
  if (companyLines.length === 0) console.log("  （无）");
  for (const line of companyLines) console.log(`  ${line}`);
  console.log("product（在册公司产品/子品牌，可考虑为 parent 补 alias；不入 pending）:");
  if (productLines.length === 0) console.log("  （无）");
  for (const line of productLines) console.log(`  ${line}`);
  console.log(
    `pending 文件: ${written ? `已写入 ${PENDING_PATH}（共 ${drafts.length} 条，其中本轮新增 ${drafts.length - existing.length}）` : "无变化，未改动"}`,
  );
  console.log(`失败清单: ${failureLines.length === 0 ? "（无）" : ""}`);
  for (const line of failureLines) console.log(`  ${line}`);

  if (failureLines.length > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(`propose-companies 失败: ${errorMessage(err)}`);
  process.exitCode = 1;
});

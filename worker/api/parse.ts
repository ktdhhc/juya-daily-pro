// parse — spec10 Step 2.2–2.5：解析与审核 API 的核心逻辑（四端点的纯函数层 + 薄 IO 编排）。
// 纯函数（selectParseTargets / proposeInsertSql / proposalUpsertSql / validatePatchBody /
// assemblePending / publishDateStatements / applyProposalStatements）进 vitest
//（worker/api/parse.test.ts，先红后绿）；LLM 调用与 D1 读写为薄 IO 不单测（ADR-0011），
// 以 wrangler dev + curl 验收。
// 契约见 docs/spec/spec10-editorial-workflow.md「解析与审核 API」节（全部 requireAdmin，403 unauthorized）。
// 纪律：解析段只对 published=0 条目生效；publish 无 proposal 的条目只翻转 published 不造 role；
// SQL 生成沿用 worker/sync/sqlgen 纪律（单语句单行、`;` 结尾、escapeSqlText、幂等 upsert）。
import { enrichCacheUpsertSql } from "../../src/lib/llm/enrich-sql";
import {
  buildEnrichPrompt,
  deriveRoles,
  parseEnrichResponse,
  type EnrichCandidate,
} from "../../src/lib/llm/enrich";
import { chatJson, runWithLimiter, type LlmConfig } from "../../src/lib/llm/chat";
import { buildProposePrompt, parseProposeResponse } from "../../src/lib/llm/propose";
import { matchCandidates } from "../../src/lib/matchCompanies";
import { escapeSqlText, itemCompaniesUpsertSql } from "../sync/sqlgen";
import { chunkArray, MAX_BOUND_PARAMS } from "./queries";

const quote = (s: string): string => `'${escapeSqlText(s)}'`;
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/; // YYYY-MM-DD（格式级校验，历法合法性交给 D1）

// ---------- 服务层错误（routes.ts 捕获后转统一错误格式） ----------

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

// ---------- Worker env（routes.ts Env 的结构子集；vars 与 secret 见 wrangler.jsonc） ----------

export interface ParseEnv {
  DB: D1Database;
  LLM_API_BASE?: string;
  LLM_MODEL?: string;
  LLM_API_KEY?: string; // secret
  MAX_LLM_PER_RUN?: string;
}

// LlmConfig 构造（薄）：任一必填缺失 → 500 llm_not_configured（消息只出现键名，不出现值）。
export function llmConfigFromEnv(env: ParseEnv): LlmConfig {
  const baseUrl = env.LLM_API_BASE?.trim();
  const model = env.LLM_MODEL?.trim();
  const apiKey = env.LLM_API_KEY?.trim();
  if (apiKey === undefined || apiKey === "") {
    throw new ApiError(500, "llm_not_configured", "缺少 LLM_API_KEY");
  }
  if (baseUrl === undefined || baseUrl === "") {
    throw new ApiError(500, "llm_not_configured", "缺少 LLM_API_BASE");
  }
  if (model === undefined || model === "") {
    throw new ApiError(500, "llm_not_configured", "缺少 LLM_MODEL");
  }
  return { baseUrl, model, apiKey };
}

// MAX_LLM_PER_RUN（wrangler.jsonc vars，默认 20）：非正数/非数字回退默认值。
export function maxLlmPerRun(env: ParseEnv): number {
  const raw = Number(env.MAX_LLM_PER_RUN ?? "20");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 20;
}

// ---------- 圈题纯函数（spec10 Step 2.3） ----------

export interface StagedItemInput {
  id: string;
  title: string;
  summary: string;
  bodyMd: string;
  enrichState: string; // 'ok' | 'missing_owner' | 'pending'
}

// item_companies ⋈ companies 的归属行（aliases 供 evidence 重扫）
export interface OwnerCompanyInput {
  itemId: string;
  companyId: string;
  name: string;
  notes: string;
  aliases: string[];
}

export interface EnrichTarget {
  itemId: string;
  candidates: EnrichCandidate[]; // id=companyId（enrich 纯函数的既有形状）
}

export interface MissingTarget {
  itemId: string;
  title: string;
  summary: string;
  bodyMd: string;
}

export interface ParseTargets {
  enrichTargets: EnrichTarget[];
  missingTargets: MissingTarget[];
}

// 圈题规则（spec10 2.3）：
// - 已有 proposal（item_proposals 命中）→ 幂等跳过（判定最优先）；
// - enrich_state='missing_owner' → missingTargets（三分类 propose）；
// - 多家命中（item_companies ≥2）且无 proposal → enrichTargets（enrich 判 primary）；
// - 单家命中、非 missing 的零归属 → 跳过。
export function selectParseTargets(
  items: StagedItemInput[],
  owners: OwnerCompanyInput[],
  proposalItemIds: ReadonlySet<string>,
): ParseTargets {
  const ownersByItem = new Map<string, OwnerCompanyInput[]>();
  for (const o of owners) {
    const list = ownersByItem.get(o.itemId) ?? [];
    list.push(o);
    ownersByItem.set(o.itemId, list);
  }

  const enrichTargets: EnrichTarget[] = [];
  const missingTargets: MissingTarget[] = [];
  for (const item of items) {
    if (proposalItemIds.has(item.id)) continue; // 已有 proposal：重复 parse 幂等
    if (item.enrichState === "missing_owner") {
      missingTargets.push({
        itemId: item.id,
        title: item.title,
        summary: item.summary,
        bodyMd: item.bodyMd,
      });
      continue;
    }
    const itemOwners = ownersByItem.get(item.id) ?? [];
    if (itemOwners.length < 2) continue; // 单家命中 / 非 missing 零归属
    // 命中别名证据按 title/body 对 aliases 重扫（matchCandidates，同 scripts/enrich.ts 范式）
    const companies = itemOwners.map((o) => ({
      id: o.companyId,
      name: o.name,
      aliases: o.aliases,
      color: "",
      status: "active" as const,
      notes: o.notes,
    }));
    const evidenceById = new Map(
      matchCandidates({ title: item.title, bodyMd: item.bodyMd }, companies).map((h) => [
        h.companyId,
        h.matchedAliases,
      ]),
    );
    const lowerTitle = item.title.toLowerCase();
    const candidates: EnrichCandidate[] = itemOwners.map((o) => {
      const evidence = evidenceById.get(o.companyId) ?? [];
      return {
        id: o.companyId,
        name: o.name,
        notes: o.notes,
        evidence,
        hitInTitle: evidence.some((a) => lowerTitle.includes(a.toLowerCase())),
      };
    });
    enrichTargets.push({ itemId: item.id, candidates });
  }
  return { enrichTargets, missingTargets };
}

// ---------- SQL 生成纯函数（company_candidates / item_proposals，spec10 Step 2.3） ----------

export interface ProposalUpsertRow {
  itemId: string;
  owners: { companyId: string; role: PatchRole }[];
  llmModel: string;
}

// item_proposals upsert：冲突更新 owners/llm_model（created_at 保留首写）。
export function proposalUpsertSql(rows: ProposalUpsertRow[]): string {
  if (rows.length === 0) return "";
  const values = rows.map(
    (r) => `(${quote(r.itemId)}, ${quote(JSON.stringify(r.owners))}, ${quote(r.llmModel)})`,
  );
  return (
    "INSERT INTO item_proposals (item_id, owners, llm_model) " +
    `VALUES ${values.join(", ")} ` +
    "ON CONFLICT(item_id) DO UPDATE SET owners = excluded.owners, llm_model = excluded.llm_model;"
  );
}

export interface CandidateInsertRow {
  id: string;
  name: string;
  aliases: string[];
  confidence: string;
  reason: string;
  sourceItemId: string;
}

// company_candidates INSERT：ON CONFLICT(id) DO NOTHING——已有同名建议不覆盖（spec10 2.3 冲突策略）。
// status 不写列（落表默认 'pending'），created_at 走默认 datetime('now')。
export function proposeInsertSql(rows: CandidateInsertRow[]): string {
  if (rows.length === 0) return "";
  const values = rows.map(
    (r) =>
      `(${quote(r.id)}, ${quote(r.name)}, ${quote(JSON.stringify(r.aliases))}, ` +
      `${quote(r.confidence)}, ${quote(r.reason)}, ${quote(r.sourceItemId)})`,
  );
  return (
    "INSERT INTO company_candidates (id, name, aliases, confidence, reason, source_item_id) " +
    `VALUES ${values.join(", ")} ` +
    "ON CONFLICT(id) DO NOTHING;"
  );
}

// confidence 三档启发，与 scripts/propose-companies.ts confidenceOf 同规则
//（evidence 含域名 / 有别于 name 的别名 → high；evidence 点名 name → mid；其余 low）。
type Confidence = "high" | "mid" | "low";
function confidenceOf(name: string, aliases: string[], evidence: string): Confidence {
  if (/[a-z0-9-]+\.[a-z]{2,}/i.test(evidence)) return "high";
  if (aliases.some((a) => a.toLowerCase() !== name.toLowerCase())) return "high";
  if (evidence.toLowerCase().includes(name.toLowerCase())) return "mid";
  return "low";
}

// ---------- patch body 校验纯函数（spec10 Step 2.5） ----------

export type PatchRole = "primary" | "partner" | "subject";
export interface PatchOwner {
  companyId: string;
  role: PatchRole;
}
export type PatchValidation =
  | { ok: true; itemId: string; owners: PatchOwner[] }
  | { ok: false; message: string };

const ROLES: ReadonlySet<string> = new Set(["primary", "partner", "subject"]);

// body { itemId, owners: [{companyId, role}] }：owners 非空、companyId 非空字符串、
// role ∈ primary/partner/subject、primary ≤1（零 primary 合法）。
export function validatePatchBody(body: unknown): PatchValidation {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "body 须为对象" };
  }
  const record = body as Record<string, unknown>;
  const itemId = record.itemId;
  if (typeof itemId !== "string" || itemId.trim() === "") {
    return { ok: false, message: "itemId 须为非空字符串" };
  }
  const ownersRaw = record.owners;
  if (!Array.isArray(ownersRaw) || ownersRaw.length === 0) {
    return { ok: false, message: "owners 须为非空数组" };
  }
  const owners: PatchOwner[] = [];
  let primaryCount = 0;
  for (const raw of ownersRaw) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return { ok: false, message: "owners 元素须为对象" };
    }
    const o = raw as Record<string, unknown>;
    if (typeof o.companyId !== "string" || o.companyId.trim() === "") {
      return { ok: false, message: "owners[].companyId 须为非空字符串" };
    }
    if (typeof o.role !== "string" || !ROLES.has(o.role)) {
      return { ok: false, message: "owners[].role 须为 primary/partner/subject" };
    }
    if (o.role === "primary") primaryCount += 1;
    owners.push({ companyId: o.companyId, role: o.role as PatchRole });
  }
  if (primaryCount > 1) {
    return { ok: false, message: "primary 至多 1 个" };
  }
  return { ok: true, itemId, owners };
}

// ---------- pending 组装纯函数（GET /api/review/pending，spec10 契约） ----------

export interface PendingItemRow {
  id: string;
  date: string;
  tag: string;
  category: string;
  title: string;
  summary: string;
}
export interface PendingOwnerRow {
  itemId: string;
  companyId: string;
  name: string;
  color: string;
  role: string | null;
}
export interface PendingProposalRow {
  itemId: string;
  owners: string; // JSON [{companyId, role}] 字面量
  llmModel: string;
}
export interface PendingCandidateRow {
  id: string;
  name: string;
  aliases: string; // JSON 数组字面量
  confidence: string;
  reason: string;
  sourceItemId: string;
}

export interface PendingOwner {
  companyId: string;
  name: string;
  color: string;
  role: PatchRole | null;
}
export interface PendingProposal {
  owners: { companyId: string; role: PatchRole }[];
  llmModel: string;
}
export interface PendingCandidate {
  id: string;
  name: string;
  aliases: string[];
  confidence: string;
  reason: string;
}
export interface PendingItem {
  id: string;
  title: string;
  summary: string;
  category: string;
  tag: string;
  owners: PendingOwner[];
  proposal: PendingProposal | null;
  candidate: PendingCandidate | null; // source_item_id 指向该条目的首个 pending 候选
}
export interface PendingDateGroup {
  date: string;
  items: PendingItem[];
}
export interface PendingPayload {
  dates: PendingDateGroup[]; // 日期升序
  candidates: Array<PendingCandidate & { sourceItemId: string }>; // pending 候选全量
}

function parseJsonStringArray(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

// proposal owners JSON → 结构化数组；损坏 JSON / 元素形态不符 → null（组装层容忍为无 proposal）
function parseProposalOwners(raw: string): { companyId: string; role: PatchRole }[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const owners: { companyId: string; role: PatchRole }[] = [];
  for (const o of parsed) {
    if (typeof o !== "object" || o === null) return null;
    const r = o as Record<string, unknown>;
    if (typeof r.companyId !== "string" || typeof r.role !== "string" || !ROLES.has(r.role)) {
      return null;
    }
    owners.push({ companyId: r.companyId, role: r.role as PatchRole });
  }
  return owners;
}

export function assemblePending(
  items: PendingItemRow[],
  ownerRows: PendingOwnerRow[],
  proposalRows: PendingProposalRow[],
  candidateRows: PendingCandidateRow[],
): PendingPayload {
  const ownersByItem = new Map<string, PendingOwner[]>();
  for (const r of ownerRows) {
    const list = ownersByItem.get(r.itemId) ?? [];
    list.push({
      companyId: r.companyId,
      name: r.name,
      color: r.color,
      role: r.role === "primary" || r.role === "partner" || r.role === "subject" ? r.role : null,
    });
    ownersByItem.set(r.itemId, list);
  }
  const proposalByItem = new Map<string, PendingProposal>();
  for (const r of proposalRows) {
    const owners = parseProposalOwners(r.owners);
    if (owners !== null) proposalByItem.set(r.itemId, { owners, llmModel: r.llmModel });
  }
  const candidateByItem = new Map<string, PendingCandidateRow>();
  for (const c of candidateRows) {
    if (!candidateByItem.has(c.sourceItemId)) candidateByItem.set(c.sourceItemId, c);
  }

  const byDate = new Map<string, PendingItem[]>();
  for (const it of items) {
    const cand = candidateByItem.get(it.id);
    const group = byDate.get(it.date) ?? [];
    group.push({
      id: it.id,
      title: it.title,
      summary: it.summary,
      category: it.category,
      tag: it.tag,
      owners: ownersByItem.get(it.id) ?? [],
      proposal: proposalByItem.get(it.id) ?? null,
      candidate:
        cand === undefined
          ? null
          : {
              id: cand.id,
              name: cand.name,
              aliases: parseJsonStringArray(cand.aliases),
              confidence: cand.confidence,
              reason: cand.reason,
            },
    });
    byDate.set(it.date, group);
  }
  const dates = [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, groupItems]) => ({ date, items: groupItems }));
  return {
    dates,
    candidates: candidateRows.map((c) => ({
      id: c.id,
      name: c.name,
      aliases: parseJsonStringArray(c.aliases),
      confidence: c.confidence,
      reason: c.reason,
      sourceItemId: c.sourceItemId,
    })),
  };
}

// ---------- publish 语句纯函数（POST /api/review/publish，spec10 Step 2.5） ----------

// published 0→1：sources 与 items 两个日期集合 UPDATE（DO UPDATE 不含 published 的反向操作）。
export function publishDateStatements(dates: string[]): string[] {
  if (dates.length === 0) return [];
  const list = dates.map(quote).join(", ");
  return [
    `UPDATE sources SET published = 1 WHERE date IN (${list});`,
    `UPDATE items SET published = 1 WHERE date IN (${list});`,
  ];
}

// 单条 proposal 条目的应用语句组（同 PATCH 语义：删后插 + enrich_state='ok' + enrich_cache 写入，
// result=owners JSON、llm_model）。返回单语句单行数组，调用方并入 D1 batch（部分失败整体回滚）。
export function applyProposalStatements(
  itemId: string,
  owners: PatchOwner[],
  llmModel: string,
): string[] {
  return [
    `DELETE FROM item_companies WHERE item_id = ${quote(itemId)};`,
    itemCompaniesUpsertSql(owners.map((o) => ({ itemId, companyId: o.companyId, role: o.role }))),
    `UPDATE items SET enrich_state = 'ok' WHERE id = ${quote(itemId)};`,
    enrichCacheUpsertSql(itemId, JSON.stringify(owners), llmModel),
  ].filter((s) => s !== "");
}

// ---------- LLM 编排（薄 IO，不单测）：POST /api/parse ----------

export interface ParseOutcome {
  processed: number; // 本次成功条数（enrich 出 proposal / propose 三分类成功）
  candidatesFound: number; // 本次落库的 company 候选数（product/ignore 仅计数不落库）
  remaining: number; // 圈题池中本次未处理余量（含被 MAX_LLM_PER_RUN 截断与单条失败）
  skipped: number; // 单条 LLM 失败数（不阻塞整批）
  errors: string[]; // 失败清单（截断，reason 摘要级）
}

const ERRORS_MAX = 5; // 错误清单截断上限

// parse 主流程：读暂存条目（published=0）→ selectParseTargets → runWithLimiter(MAX_LLM_PER_RUN)
// → enrich/propose 双 job → D1 batch 写 item_proposals / company_candidates。
// 重复调用幂等：已有 proposal 的条目被 selectParseTargets 圈题时跳过。
export async function runParse(env: ParseEnv): Promise<ParseOutcome> {
  const cfg = llmConfigFromEnv(env);
  const maxLlm = maxLlmPerRun(env);

  // 1) 暂存条目（解析段只对 published=0 生效）
  const itemRows = await env.DB.prepare(
    "SELECT id, title, summary, body_md, enrich_state FROM items WHERE published = 0 ORDER BY id",
  ).all<{ id: string; title: string; summary: string; body_md: string; enrich_state: string }>();
  const items: StagedItemInput[] = itemRows.results.map((r) => ({
    id: r.id,
    title: r.title,
    summary: r.summary,
    bodyMd: r.body_md,
    enrichState: r.enrich_state,
  }));
  const itemIds = items.map((i) => i.id);

  // 2) 归属（item_companies ⋈ companies，分块防 D1 绑定参数上限）
  const owners: OwnerCompanyInput[] = [];
  for (const chunk of chunkArray(itemIds, MAX_BOUND_PARAMS)) {
    const placeholders = chunk.map(() => "?").join(",");
    const rows = await env.DB.prepare(
      "SELECT ic.item_id AS itemId, ic.company_id AS companyId, c.name, c.notes, c.aliases" +
        " FROM item_companies ic JOIN companies c ON c.id = ic.company_id" +
        ` WHERE ic.item_id IN (${placeholders}) ORDER BY ic.item_id, ic.company_id`,
    )
      .bind(...chunk)
      .all<{ itemId: string; companyId: string; name: string; notes: string; aliases: string }>();
    for (const r of rows.results) {
      owners.push({
        itemId: r.itemId,
        companyId: r.companyId,
        name: r.name,
        notes: r.notes,
        aliases: parseJsonStringArray(r.aliases),
      });
    }
  }

  // 3) 已有 proposal（幂等圈题依据）
  const proposalItemIds = new Set<string>();
  for (const chunk of chunkArray(itemIds, MAX_BOUND_PARAMS)) {
    const placeholders = chunk.map(() => "?").join(",");
    const rows = await env.DB.prepare(
      `SELECT item_id FROM item_proposals WHERE item_id IN (${placeholders})`,
    )
      .bind(...chunk)
      .all<{ item_id: string }>();
    for (const r of rows.results) proposalItemIds.add(r.item_id);
  }

  // 4) 圈题 + MAX_LLM_PER_RUN 限流（enrich 优先、保持 id 序）
  const { enrichTargets, missingTargets } = selectParseTargets(items, owners, proposalItemIds);
  const itemById = new Map(items.map((i) => [i.id, i]));
  type Capped = { kind: "enrich"; target: EnrichTarget } | { kind: "propose"; target: MissingTarget };
  const capped: Capped[] = [
    ...enrichTargets.map((t): Capped => ({ kind: "enrich", target: t })),
    ...missingTargets.map((t): Capped => ({ kind: "propose", target: t })),
  ].slice(0, maxLlm);
  const totalTargets = enrichTargets.length + missingTargets.length;

  // 在册公司名清单（propose prompt 用）
  const companyNames = await env.DB.prepare("SELECT name FROM companies ORDER BY id").all<{ name: string }>();
  const registryNames = companyNames.results.map((r) => r.name);

  // 5) 双 job：enrich 判 primary + deriveRoles → proposal 行；propose 三分类 → company 候选行。
  //    单条 LLM 失败兜底记录不中断整批（同 scripts/enrich.ts 范式）。
  type JobOutcome =
    | { ok: true; proposal?: ProposalUpsertRow; candidate?: CandidateInsertRow }
    | { ok: false; error: string };
  const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

  const results = await runWithLimiter(
    capped.map(
      (c): (() => Promise<JobOutcome>) =>
        c.kind === "enrich"
          ? async () => {
              const item = itemById.get(c.target.itemId);
              if (item === undefined) return { ok: false, error: `${c.target.itemId}: 条目数据不一致` };
              try {
                const prompt = buildEnrichPrompt(item, c.target.candidates);
                const raw = await chatJson(cfg, prompt.system, prompt.user);
                const parsed = parseEnrichResponse(
                  raw,
                  c.target.candidates.map((x) => x.id),
                );
                if (parsed === null) {
                  return { ok: false, error: `${c.target.itemId}: enrich 响应不合法（前 120 字符）：${raw.slice(0, 120)}` };
                }
                const verdicts = deriveRoles(item, c.target.candidates, parsed.primaryId, parsed.reason);
                return {
                  ok: true,
                  proposal: {
                    itemId: c.target.itemId,
                    owners: verdicts.map((v) => ({ companyId: v.companyId, role: v.role })),
                    llmModel: cfg.model,
                  },
                };
              } catch (err) {
                return { ok: false, error: `${c.target.itemId}: ${errorMessage(err)}` };
              }
            }
          : async () => {
              try {
                const prompt = buildProposePrompt(c.target, registryNames);
                const raw = await chatJson(cfg, prompt.system, prompt.user);
                const verdict = parseProposeResponse(raw, registryNames);
                if (verdict === null) {
                  return { ok: false, error: `${c.target.itemId}: propose 响应不合法（前 120 字符）：${raw.slice(0, 120)}` };
                }
                if (verdict.kind !== "company") return { ok: true }; // product/ignore 仅计数
                const evidence = verdict.evidence.replace(/\s+/g, " ").trim();
                return {
                  ok: true,
                  candidate: {
                    id: verdict.id,
                    name: verdict.name,
                    aliases: verdict.aliases,
                    confidence: confidenceOf(verdict.name, verdict.aliases, evidence),
                    reason: evidence,
                    sourceItemId: c.target.itemId,
                  },
                };
              } catch (err) {
                return { ok: false, error: `${c.target.itemId}: ${errorMessage(err)}` };
              }
            },
    ),
    maxLlm,
  );

  // 6) D1 batch 写入（proposal upsert + 候选 DO NOTHING；空则无语句）
  const proposalRows = results.flatMap((r) => (r.ok && r.proposal !== undefined ? [r.proposal] : []));
  const candidateRows = results.flatMap((r) => (r.ok && r.candidate !== undefined ? [r.candidate] : []));
  const deduped = new Map<string, CandidateInsertRow>();
  for (const c of candidateRows) {
    if (!deduped.has(c.id)) deduped.set(c.id, c); // 同轮同 id 候选去重（SQL 侧 DO NOTHING 兜底）
  }
  const statements = [proposalUpsertSql(proposalRows), proposeInsertSql([...deduped.values()])].filter(
    (s) => s !== "",
  );
  if (statements.length > 0) {
    await env.DB.batch(statements.map((s) => env.DB.prepare(s)));
  }

  const processed = results.filter((r) => r.ok).length;
  const skipped = results.length - processed;
  return {
    processed,
    candidatesFound: deduped.size,
    remaining: totalTargets - processed,
    skipped,
    errors: results.flatMap((r) => (r.ok ? [] : [r.error])).slice(0, ERRORS_MAX),
  };
}

// ---------- 薄 IO：GET /api/review/pending ----------

export async function reviewPending(env: ParseEnv): Promise<PendingPayload> {
  const itemRows = await env.DB.prepare(
    "SELECT id, date, tag, category, title, summary FROM items WHERE published = 0 " +
      "ORDER BY date ASC, sequence_int ASC, id ASC",
  ).all<PendingItemRow>();
  const itemIds = itemRows.results.map((r) => r.id);

  const ownerRows: PendingOwnerRow[] = [];
  const proposalRows: PendingProposalRow[] = [];
  for (const chunk of chunkArray(itemIds, MAX_BOUND_PARAMS)) {
    const placeholders = chunk.map(() => "?").join(",");
    const ownersRes = await env.DB.prepare(
      "SELECT ic.item_id AS itemId, ic.company_id AS companyId, c.name, c.color, ic.role" +
        " FROM item_companies ic JOIN companies c ON c.id = ic.company_id" +
        ` WHERE ic.item_id IN (${placeholders}) ORDER BY ic.item_id, ic.company_id`,
    )
      .bind(...chunk)
      .all<PendingOwnerRow>();
    ownerRows.push(...ownersRes.results);
    const proposalsRes = await env.DB.prepare(
      `SELECT item_id AS itemId, owners, llm_model AS llmModel FROM item_proposals WHERE item_id IN (${placeholders})`,
    )
      .bind(...chunk)
      .all<PendingProposalRow>();
    proposalRows.push(...proposalsRes.results);
  }

  const candidateRows = await env.DB.prepare(
    "SELECT id, name, aliases, confidence, reason, source_item_id AS sourceItemId " +
      "FROM company_candidates WHERE status = 'pending' ORDER BY id",
  ).all<PendingCandidateRow>();

  return assemblePending(itemRows.results, ownerRows, proposalRows, candidateRows.results);
}

// ---------- 薄 IO：PATCH /api/review/item ----------

export interface PatchOutcome {
  itemId: string;
  owners: number;
}

// 重写该条 item_companies（删后插，batch 原子）+ enrich_state='ok'。
// 仅允许 published=0 条目；companyId 须在册（FK 兜底之外的干净 400）。
// PATCH 语句组（纯函数）：重写 item_companies + enrich_state='ok' +
// **人工编辑同步回 proposal 行**（llm_model='human-edit' 标记）——publish 重放 proposal
// 即重放人工终版，否则直接入库会把人工修改冲回 LLM 原案（spec10 review P1 修复）。
export function patchStatements(
  itemId: string,
  owners: { companyId: string; role: PatchRole }[],
): string[] {
  return [
    `DELETE FROM item_companies WHERE item_id = ${quote(itemId)};`,
    itemCompaniesUpsertSql(owners.map((o) => ({ itemId, companyId: o.companyId, role: o.role }))),
    `UPDATE items SET enrich_state = 'ok' WHERE id = ${quote(itemId)};`,
    proposalUpsertSql([{ itemId, owners, llmModel: "human-edit" }]),
  ];
}

export async function reviewPatch(env: ParseEnv, body: unknown): Promise<PatchOutcome> {
  const v = validatePatchBody(body);
  if (!v.ok) throw new ApiError(400, "invalid_param", v.message);

  const row = await env.DB.prepare("SELECT published FROM items WHERE id = ?")
    .bind(v.itemId)
    .first<{ published: number }>();
  if (row === null) throw new ApiError(404, "not_found", `条目不存在：${v.itemId}`);
  if (Number(row.published) === 1) {
    throw new ApiError(400, "invalid_param", "已入库条目请走人工纠错通道");
  }

  const companyIds = [...new Set(v.owners.map((o) => o.companyId))];
  const found = new Set<string>();
  for (const chunk of chunkArray(companyIds, MAX_BOUND_PARAMS)) {
    const placeholders = chunk.map(() => "?").join(",");
    const res = await env.DB.prepare(`SELECT id FROM companies WHERE id IN (${placeholders})`)
      .bind(...chunk)
      .all<{ id: string }>();
    for (const r of res.results) found.add(r.id);
  }
  const missing = companyIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new ApiError(400, "invalid_param", `未知公司：${missing.join(", ")}`);
  }

  await env.DB.batch(patchStatements(v.itemId, v.owners).map((s) => env.DB.prepare(s)));
  return { itemId: v.itemId, owners: v.owners.length };
}

// ---------- 薄 IO：POST /api/review/publish ----------

export interface PublishOutcome {
  publishedDates: string[];
  itemsPublished: number;
}

// dates 缺省=全部含暂存条目的日期；D1 batch 原子：published 0→1 + 应用 proposal owners
//（同 PATCH 语义 + enrich_cache）。无 proposal 的条目只翻转 published 不造 role。
export async function reviewPublish(env: ParseEnv, body: unknown): Promise<PublishOutcome> {
  if (body !== undefined && body !== null && (typeof body !== "object" || Array.isArray(body))) {
    throw new ApiError(400, "invalid_param", "body 须为对象或缺省");
  }
  const rawDates = (body as Record<string, unknown> | null | undefined)?.dates;
  let dates: string[];
  if (rawDates === undefined) {
    const rows = await env.DB.prepare(
      "SELECT DISTINCT date FROM items WHERE published = 0 ORDER BY date ASC",
    ).all<{ date: string }>();
    dates = rows.results.map((r) => r.date);
  } else {
    if (
      !Array.isArray(rawDates) ||
      rawDates.length === 0 ||
      !rawDates.every((d) => typeof d === "string" && RE_DATE.test(d))
    ) {
      throw new ApiError(400, "invalid_param", "dates 须为非空的 YYYY-MM-DD 字符串数组");
    }
    dates = [...new Set(rawDates as string[])].sort();
  }
  if (dates.length === 0) return { publishedDates: [], itemsPublished: 0 };

  // 本次翻转的暂存条目 + 其 proposal（proposal JSON 损坏 → 只翻 published 不应用）
  const dateList = dates.map(quote).join(", ");
  const stagedRes = await env.DB.prepare(
    `SELECT id FROM items WHERE published = 0 AND date IN (${dateList}) ORDER BY id`,
  ).all<{ id: string }>();
  const stagedIds = stagedRes.results.map((r) => r.id);
  const proposalRows: PendingProposalRow[] = [];
  for (const chunk of chunkArray(stagedIds, MAX_BOUND_PARAMS)) {
    const placeholders = chunk.map(() => "?").join(",");
    const res = await env.DB.prepare(
      `SELECT item_id AS itemId, owners, llm_model AS llmModel FROM item_proposals WHERE item_id IN (${placeholders})`,
    )
      .bind(...chunk)
      .all<PendingProposalRow>();
    proposalRows.push(...res.results);
  }

  const statements = [
    ...publishDateStatements(dates),
    ...proposalRows.flatMap((p) => {
      const owners = parseProposalOwners(p.owners);
      if (owners === null || owners.length === 0) return [];
      return applyProposalStatements(p.itemId, owners, p.llmModel);
    }),
  ];
  await env.DB.batch(statements.map((s) => env.DB.prepare(s)));
  return { publishedDates: dates, itemsPublished: stagedIds.length };
}

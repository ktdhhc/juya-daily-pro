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
import {
  assembleParseState,
  emptyParseState,
  parseBusy,
  parseStateUpsertSql,
  type ParseStatePayload,
  type ParseStateRow,
  type ParseStateWrite,
} from "./parse-state";
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

// 圈题规则（spec10 2.3；spec11 契约 B 扩展已发布补救类）：
// - 已有 proposal（item_proposals 命中）→ 幂等跳过（判定最优先）；
// - enrich_state='missing_owner' → missingTargets（三分类 propose）；
// - 多家命中（item_companies ≥2）且无 proposal → enrichTargets（enrich 判 primary）；
// - 单家命中、非 missing 的零归属 → 跳过。
// publishedMissingItems（spec11）：已发布但缺主次的补救类输入（buildPublishedMissingRolesQuery
// 的行），与暂存类合并圈题——同 id 两类并存时暂存类优先（去重只算一份）。
// **proposal 幂等跳过只约束暂存类**：已发布条目没有后续 publish 节点，历史 proposal + role NULL
// 正是待补救形态（20260829-6 实测），重解析生成新裁决并立即应用（runParse）。
export function selectParseTargets(
  items: StagedItemInput[],
  owners: OwnerCompanyInput[],
  proposalItemIds: ReadonlySet<string>,
  publishedMissingItems: StagedItemInput[] = [],
  candidateHandledIds: ReadonlySet<string> = new Set(),
): ParseTargets {
  const ownersByItem = new Map<string, OwnerCompanyInput[]>();
  for (const o of owners) {
    const list = ownersByItem.get(o.itemId) ?? [];
    list.push(o);
    ownersByItem.set(o.itemId, list);
  }

  // 已发布类并入（暂存类优先去重）；仅暂存类受 proposal 跳过约束
  const stagedIds = new Set(items.map((i) => i.id));
  const publishedOnly = new Set(
    publishedMissingItems.filter((p) => !stagedIds.has(p.id)).map((p) => p.id),
  );
  const merged = [...items, ...publishedMissingItems.filter((p) => !stagedIds.has(p.id))];

  const enrichTargets: EnrichTarget[] = [];
  const missingTargets: MissingTarget[] = [];
  for (const item of merged) {
    if (proposalItemIds.has(item.id) && !publishedOnly.has(item.id)) continue; // 暂存类已有 proposal：重复 parse 幂等
    if (item.enrichState === "missing_owner") {
      // spec12：缺公司候选已提议（company_candidates.source_item_id 命中）→ 跳过——
      // 公司未入册前条目恒为 missing_owner，不跳过则每次 parse 重复调 LLM
      if (candidateHandledIds.has(item.id)) continue;
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

// 已发布补救类圈题查询（spec11 契约 B，纯构造器）：published=1、多家命中、
// 无 enrich_cache、且存在 role IS NULL 的归属行——解析失败后的人工补救通道。
// 有 enrich_cache 的条目永不重圈（人工纠错走 enrich --apply，spec09）。
// **不排除有 proposal 的条目**：已发布条目没有后续 publish 节点，历史 proposal + role NULL
// 正是「建议未落地」的待补救形态（实测 20260829-6 演练暴露）；role 齐全的自然被 role 条件排除。
export function buildPublishedMissingRolesQuery(): { sql: string; params: string[] } {
  return {
    sql:
      "SELECT i.id, i.title, i.summary, i.body_md, i.enrich_state" +
      " FROM items i WHERE i.published = 1" +
      " AND NOT EXISTS (SELECT 1 FROM enrich_cache ec WHERE ec.item_id = i.id)" +
      " AND (SELECT COUNT(*) FROM item_companies ic WHERE ic.item_id = i.id) >= 2" +
      " AND EXISTS (SELECT 1 FROM item_companies ic2 WHERE ic2.item_id = i.id AND ic2.role IS NULL)" +
      " ORDER BY i.id",
    params: [],
  };
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
  parse: ParseStatePayload; // spec13 契约 C：解析作业状态（reviewPending 读 parse_state 单行附加；assemblePending 不查库）
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
): Omit<PendingPayload, "parse"> {
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

// ---------- LLM 编排（薄 IO，不单测）：POST /api/parse 异步作业（spec13 契约 B） ----------

export interface ParseOutcome {
  processed: number; // 本次成功条数（enrich 出 proposal / propose 三分类成功）
  candidatesFound: number; // 本次落库的 company 候选数（product/ignore 仅计数不落库）
  remaining: number; // 圈题池中本次未处理余量（含被 MAX_LLM_PER_RUN 截断与单条失败）
  skipped: number; // 单条 LLM 失败数（不阻塞整批）
  errors: string[]; // 失败清单（截断，reason 摘要级）
}

const ERRORS_MAX = 5; // 错误清单截断上限

// 单条目标的作业类别（enrich 判 primary / propose 三分类）
type CappedJob =
  | { kind: "enrich"; target: EnrichTarget }
  | { kind: "propose"; target: MissingTarget };

// 启动阶段（无 LLM 调用）产出：执行体的全部输入 + total 计数。
// spec13：圈题查询提前到启动阶段——POST /api/parse 先据此写 running(total) 并秒回响应，
// LLM 调用延后到 ctx.waitUntil 的执行体（executeParse）。
export interface ParseJobContext {
  items: StagedItemInput[]; // staged + 已发布补救类合并集
  itemById: Map<string, StagedItemInput>;
  publishedIds: Set<string>; // 已发布补救类条目 id（proposal 立即应用判定）
  capped: CappedJob[]; // 执行清单（MAX_LLM_PER_RUN 截断后）
  totalTargets: number; // 圈题总数（未截断口径，与 ParseOutcome.remaining 一致）
  registryNames: string[]; // 在册公司名清单（propose prompt 用）
}

// 启动阶段（spec11 契约 B 扩展口径不变）：读暂存条目（published=0）+ 已发布补救类
//（buildPublishedMissingRolesQuery：多家命中缺主次、解析失败后的重解析通道）→ selectParseTargets
// 圈题 → 截断执行清单。重复调用幂等：已有 proposal 的暂存条目被圈题跳过；
// 有 enrich_cache 的已发布条目由查询排除。
export async function collectParseContext(env: ParseEnv): Promise<ParseJobContext> {
  const maxLlm = maxLlmPerRun(env);

  // 1) 暂存条目（published=0）+ 已发布补救类（spec11）
  const itemRows = await env.DB.prepare(
    "SELECT id, title, summary, body_md, enrich_state FROM items WHERE published = 0 ORDER BY id",
  ).all<{ id: string; title: string; summary: string; body_md: string; enrich_state: string }>();
  const stagedItems: StagedItemInput[] = itemRows.results.map((r) => ({
    id: r.id,
    title: r.title,
    summary: r.summary,
    bodyMd: r.body_md,
    enrichState: r.enrich_state,
  }));
  const publishedQ = buildPublishedMissingRolesQuery();
  const publishedRows = await env.DB.prepare(publishedQ.sql).all<{
    id: string;
    title: string;
    summary: string;
    body_md: string;
    enrich_state: string;
  }>();
  const publishedItems: StagedItemInput[] = publishedRows.results.map((r) => ({
    id: r.id,
    title: r.title,
    summary: r.summary,
    bodyMd: r.body_md,
    enrichState: r.enrich_state,
  }));
  const publishedIds = new Set(publishedItems.map((p) => p.id));
  const items = [...stagedItems, ...publishedItems];
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

  // 3) 已有 proposal（幂等圈题依据）+ 已提议候选的 missing 条目（spec12 跳过闸门）
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
  const candidateHandledIds = new Set<string>();
  if (itemIds.length > 0) {
    for (const chunk of chunkArray(itemIds, MAX_BOUND_PARAMS)) {
      const placeholders = chunk.map(() => "?").join(",");
      const rows = await env.DB.prepare(
        `SELECT source_item_id FROM company_candidates WHERE source_item_id IN (${placeholders})`,
      )
        .bind(...chunk)
        .all<{ source_item_id: string }>();
      for (const r of rows.results) candidateHandledIds.add(r.source_item_id);
    }
  }

  // 4) 圈题 + MAX_LLM_PER_RUN 截断（enrich 优先、保持 id 序；已发布补救类并入合并圈题）
  const { enrichTargets, missingTargets } = selectParseTargets(
    stagedItems,
    owners,
    proposalItemIds,
    publishedItems,
    candidateHandledIds,
  );
  const itemById = new Map(items.map((i) => [i.id, i]));
  const capped: CappedJob[] = [
    ...enrichTargets.map((t): CappedJob => ({ kind: "enrich", target: t })),
    ...missingTargets.map((t): CappedJob => ({ kind: "propose", target: t })),
  ].slice(0, maxLlm);
  const totalTargets = enrichTargets.length + missingTargets.length;

  // 在册公司名清单（propose prompt 用）
  const companyNames = await env.DB.prepare("SELECT name FROM companies ORDER BY id").all<{ name: string }>();
  const registryNames = companyNames.results.map((r) => r.name);

  return { items, itemById, publishedIds, capped, totalTargets, registryNames };
}

// 每条完成的进度更新（processed 仅计成功，与 ParseOutcome 口径一致）
export interface ParseProgressUpdate {
  processed: number;
  remaining: number;
  errors: string[];
}
export type ParseProgressCallback = (update: ParseProgressUpdate) => void;

// 执行体（LLM 编排 + proposal/候选落库）：消费 collectParseContext 产出，每条完成即回调
// onProgress（可选；作业路径借它增量写 parse_state）。返回口径与旧 runParse 完全一致：
// D1 batch 写 item_proposals / company_candidates；**已发布条目的 proposal 立即应用**
//（applyProposalStatements 直接生效 role，不等 publish——条目已入库，没有后续 publish 节点）。
export async function executeParse(
  env: ParseEnv,
  context: ParseJobContext,
  onProgress?: ParseProgressCallback,
): Promise<ParseOutcome> {
  const cfg = llmConfigFromEnv(env);
  const maxLlm = maxLlmPerRun(env);

  // 5) 双 job：enrich 判 primary + deriveRoles → proposal 行；propose 三分类 → company 候选行。
  //    单条 LLM 失败兜底记录不中断整批（同 scripts/enrich.ts 范式）。
  type JobOutcome =
    | { ok: true; proposal?: ProposalUpsertRow; candidate?: CandidateInsertRow }
    | { ok: false; error: string };
  const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

  // 单条目标 → 作业函数（enrich / propose 两分支，原 runParse 闭包原样迁入）
  const jobOf = (c: CappedJob): (() => Promise<JobOutcome>) =>
    c.kind === "enrich"
      ? async () => {
          const item = context.itemById.get(c.target.itemId);
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
            const prompt = buildProposePrompt(c.target, context.registryNames);
            const raw = await chatJson(cfg, prompt.system, prompt.user);
            const verdict = parseProposeResponse(raw, context.registryNames);
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
        };

  // 逐条完成记账：processed 仅计成功、errors 收失败清单；每条完成即回调 onProgress（spec13）
  let processed = 0;
  const errors: string[] = [];
  const results = await runWithLimiter(
    context.capped.map(
      (c) => async (): Promise<JobOutcome> => {
        const r = await jobOf(c)();
        if (r.ok) processed += 1;
        else errors.push(r.error);
        onProgress?.({
          processed,
          remaining: context.totalTargets - processed,
          errors: errors.slice(0, ERRORS_MAX),
        });
        return r;
      },
    ),
    maxLlm,
  );

  // 6) D1 batch 写入（proposal upsert + 候选 DO NOTHING；空则无语句）。
  //    已发布条目的 proposal 立即应用（spec11 契约 B）：applyProposalStatements 直接改写
  //    item_companies role + enrich_cache——条目已在库，无后续 publish 节点可依赖。
  const proposalRows = results.flatMap((r) => (r.ok && r.proposal !== undefined ? [r.proposal] : []));
  const candidateRows = results.flatMap((r) => (r.ok && r.candidate !== undefined ? [r.candidate] : []));
  const deduped = new Map<string, CandidateInsertRow>();
  for (const c of candidateRows) {
    if (!deduped.has(c.id)) deduped.set(c.id, c); // 同轮同 id 候选去重（SQL 侧 DO NOTHING 兜底）
  }
  const statements = [proposalUpsertSql(proposalRows), proposeInsertSql([...deduped.values()])].filter(
    (s) => s !== "",
  );
  for (const p of proposalRows) {
    if (!context.publishedIds.has(p.itemId)) continue; // 暂存类：等 publish 应用（spec10 语义）
    statements.push(
      ...applyProposalStatements(
        p.itemId,
        p.owners.map((o) => ({ companyId: o.companyId, role: o.role })),
        p.llmModel,
      ),
    );
  }
  if (statements.length > 0) {
    await env.DB.batch(statements.map((s) => env.DB.prepare(s)));
  }

  const skipped = results.length - processed;
  return {
    processed,
    candidatesFound: deduped.size,
    remaining: context.totalTargets - processed,
    skipped,
    errors: results.flatMap((r) => (r.ok ? [] : [r.error])).slice(0, ERRORS_MAX),
  };
}

// 兼容入口（签名向后兼容：onProgress 为可选新增参数）——启动阶段 + 执行体一体。
// POST /api/parse 作业路径不走这里（startParse 拆两段以支持 ctx.waitUntil 异步续跑）。
export async function runParse(env: ParseEnv, onProgress?: ParseProgressCallback): Promise<ParseOutcome> {
  return executeParse(env, await collectParseContext(env), onProgress);
}

// ---------- parse_state 读写与作业编排（spec13 契约 A/B，薄 IO） ----------

// 读 parse_state 单行（迁移 seed 后恒存在；无行 → idle 等价行归一兜底）
export async function readParseState(env: ParseEnv): Promise<ParseStateRow> {
  const row = await env.DB.prepare(
    "SELECT id, status, started_at AS startedAt, finished_at AS finishedAt, processed, total, remaining, errors FROM parse_state WHERE id = 1",
  ).first<ParseStateRow>();
  return row ?? emptyParseState();
}

// 写 parse_state 单行（upsert 全列；单语句 prepare 执行，SQL 由 parseStateUpsertSql 纪律生成）
export async function writeParseState(env: ParseEnv, state: ParseStateWrite): Promise<void> {
  await env.DB.prepare(parseStateUpsertSql(state)).run();
}

export interface StartParseResult {
  started: boolean; // false = parse_busy：已有 running 作业（routes 转 409），未启动新一轮
  state: ParseStatePayload;
}

// POST /api/parse 异步作业入口（spec13 契约 B）：busy 守卫 → 启动阶段圈题计数 → 置 running →
// 立即返回 → 执行体经 ctx.waitUntil 续跑（无 ctx 回退 await 同步执行）。
// preContext（spec15 票 03）：定时任务已圈题时透传，避免同一轮重复查询；缺省自行圈题，
// HTTP 路径行为不变（busy 守卫与 409 语义仍由本函数唯一裁决）。
export async function startParse(
  env: ParseEnv,
  ctx?: ExecutionContext,
  preContext?: ParseJobContext,
): Promise<StartParseResult> {
  const prev = await readParseState(env);
  const now = new Date();
  if (parseBusy(prev, now)) {
    return { started: false, state: assembleParseState(prev) };
  }
  // 圈题查询提前到启动阶段：total=本轮圈题数（未按 MAX_LLM_PER_RUN 截断，与 remaining 口径一致）
  const context = preContext ?? (await collectParseContext(env));
  const startedAt = now.toISOString();
  const total = context.totalTargets;
  await writeParseState(env, {
    status: "running",
    startedAt,
    finishedAt: null,
    processed: 0,
    total,
    remaining: total,
    errors: [],
  });
  const execution = runParseJob(env, context, startedAt);
  if (ctx === undefined) {
    await execution; // 无 ctx 回退同步执行（兼容既有调用场景）
  } else {
    ctx.waitUntil(execution); // 响应先行，解析在后台续跑
  }
  return {
    started: true,
    state: { status: "running", startedAt, finishedAt: null, processed: 0, total, remaining: total, errors: [] },
  };
}

// 作业执行体包装：借 onProgress 增量写 parse_state（processed/remaining/errors 每条完成即 UPDATE），
// 正常结束置 done（errors 保留），整体异常置 failed。parse_state 写经 promise 链串行——
// 并发 LLM 完成回调的写库按完成序落库，防迟到的旧进度写覆盖新值/终态。
async function runParseJob(env: ParseEnv, context: ParseJobContext, startedAt: string): Promise<void> {
  const total = context.totalTargets;
  const progress: ParseProgressUpdate = { processed: 0, remaining: total, errors: [] };
  let chain: Promise<void> = Promise.resolve();
  const enqueue = (state: ParseStateWrite): void => {
    chain = chain
      .then(() => writeParseState(env, state))
      .catch(() => {}); // 单次进度写失败不阻塞解析推进（终态写库兜底纠正计数）
  };
  try {
    const outcome = await executeParse(env, context, (update) => {
      Object.assign(progress, update);
      enqueue({ status: "running", startedAt, finishedAt: null, total, ...progress });
    });
    // 终态也入链：保证落在最后一条进度写之后（防 done 被迟到的 running 写覆盖）
    chain = chain.then(() =>
      writeParseState(env, {
        status: "done",
        startedAt,
        finishedAt: new Date().toISOString(),
        total,
        processed: outcome.processed,
        remaining: outcome.remaining,
        errors: outcome.errors,
      }),
    );
    await chain;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    chain = chain.then(() =>
      writeParseState(env, {
        status: "failed",
        startedAt,
        finishedAt: new Date().toISOString(),
        total,
        processed: progress.processed,
        remaining: progress.remaining,
        errors: [message],
      }),
    );
    await chain;
  }
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

  const payload = assemblePending(itemRows.results, ownerRows, proposalRows, candidateRows.results);
  // spec13 契约 C：载荷扩展 parse 字段（parse_state 单行 SELECT → 组装载荷；idle 归一）
  const stateRow = await readParseState(env);
  return { ...payload, parse: assembleParseState(stateRow) };
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

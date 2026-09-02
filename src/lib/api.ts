// Read API 前端契约（数据形状以 docs/spec/spec04-api-views.md「API 契约」节为准，钉死）。
// Worker 由并行 agent 按同一契约开发；本文件只做 fetch 与类型，不做 mock。
// 错误格式统一为 { error: { code, message } }。

import { getAdminToken } from "./auth";

export interface ItemOwner {
  /** Company Registry id（slug），owners 按 company id 排序；role=primary/partner/subject（spec09 裁决回填），单家归属为 null（ADR-0015） */
  company: string;
  name: string;
  color: string;
  role: "primary" | "partner" | "subject" | null;
}

export interface StreamItem {
  id: string; // YYYYMMDD-N
  date: string; // YYYY-MM-DD
  tag: string; // #N
  sequenceInt: number; // #N 整数，解析缺失则 0
  category: string;
  title: string;
  primaryLink: string | null;
  summary: string;
  relatedLinks: string[];
  enrichState: "ok" | "missing_owner" | "pending";
  owners: ItemOwner[];
}

export interface ItemsPage {
  items: StreamItem[];
  /** 本页最早期日；本页期数 < limit → null（到底） */
  nextBeforeDate: string | null;
}

export type CompanyStatus = "active" | "dormant" | "retired";

export interface CompanyStats {
  total: number;
  last30d: number;
  lastEventDate: string | null;
}

/** GET /api/companies 条目（按 total 倒序返回） */
export interface CompanyIndexEntry {
  id: string;
  name: string;
  color: string;
  notes: string;
  aliases: string[];
  status: CompanyStatus;
  stats: CompanyStats;
}

/** GET /api/companies/:id（档案头五块，ADR-0007） */
export interface CompanyProfileResponse {
  company: {
    id: string;
    name: string;
    color: string;
    notes: string;
    aliases: string[];
    status: CompanyStatus;
  };
  stats: CompanyStats & {
    categoryDistribution: Record<string, number>;
    coworkers: { companyId: string; name: string; color: string; count: number }[]; // ≤8 按次数倒序
    timeSpan: { earliest: string; latest: string };
  };
}

// ══════════════════════════════════════════
// 数据面板（spec08）：GET /api/stats 单端点聚合。
// 契约形状以 worker/api/stats.ts 的 StatsResponse 实际类型为准（overview 六字段含 attributedRate）。
// ══════════════════════════════════════════

/** GET /api/stats 响应（requireAdmin；403 = unauthorized） */
export interface StatsResponse {
  overview: {
    issues: number;
    items: number;
    companies: number;
    attributed: number;
    attributedRate: number;
    /** sync_log 中 status='ok' 的 MAX(attempted_at)，"YYYY-MM-DD HH:MM:SS"（UTC）；无成功同步为 null */
    lastSyncAt: string | null;
  };
  /** 近 90 天按日计数，日期升序、稀疏（无数据日缺省） */
  daily: { date: string; items: number; issues: number }[];
  /** 全部分类，count 倒序 */
  categories: { category: string; count: number }[];
  /** 公司 Top 12，count 倒序 */
  companies: { id: string; name: string; count: number }[];
  enrich: { ok: number; missing_owner: number; pending: number };
  /** 近 84 天 sync_log，升序；error 为空串时已收敛为 null */
  sync: { date: string; status: string; error: string | null }[];
}

/** GET /api/stats：数据面板聚合（spec08）。开放态（服务端未设 ADMIN_TOKEN）直出 200 */
export function fetchStats(): Promise<StatsResponse> {
  return request<StatsResponse>("/api/stats");
}

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

function extractError(res: Response): ApiError {
  const fallback = `请求失败（HTTP ${res.status}）`;
  return new ApiError("unknown", res.status, fallback);
}

/** 统一 fetch：相对路径 /api/...，非 2xx 解析 { error: { code, message } } 后抛 ApiError */
export async function apiFetch<T>(path: string): Promise<T> {
  return request<T>(path);
}

/** 拼接 /api/items 过滤参数（from/to 闭区间；before_date 分页参数由调用方单独给，不进 URL——ADR-0012）。
 *  query 为报头搜索词：URL 上用 ?query=（ADR-0012 可分享），API 侧映射为 q（spec06 契约扩展 1） */
export function itemsQueryString(params: {
  company?: string;
  category?: string;
  query?: string;
  from?: string;
  to?: string;
  beforeDate?: string | null;
  limit?: number;
}): string {
  const p = new URLSearchParams();
  if (params.company) p.set("company", params.company);
  if (params.category) p.set("category", params.category);
  if (params.query) p.set("q", params.query);
  if (params.from) p.set("from", params.from);
  if (params.to) p.set("to", params.to);
  if (params.beforeDate) p.set("before_date", params.beforeDate);
  p.set("limit", String(params.limit ?? 7));
  return p.toString();
}

/** POST /api/sync 响应（spec06 契约扩展 2 + spec10 同步段契约，钉死） */
export interface SyncResponse {
  ok: boolean;
  /** 成功同步的期日期 */
  dates: string[];
  /** 本次写入暂存区的成功期（published=0，待审核；publish 前访客不可见），与 dates 同序同值 */
  stagedDates: string[];
  /** 同步后 published=0 条目总数（spec12 契约 A：Header 同步条「M 条待审核」） */
  stagedItems: number;
  /** 消息诚实化三分类：窗口内不在库（新增）/ 在库且内容有变（更新）/ 在库且内容相同（未变化） */
  added: string[];
  updated: string[];
  unchanged: string[];
  /** 失败期：{ date, error }，单期容错不阻塞后续期 */
  failures: { date: string; error: string }[];
}

/** 同步成功条文案（消息诚实化）：新增/更新/核对三分类 + 待审核条数 + 失败期，
 *  取代无信息量的「同步 N 期」——N 只是窗口大小，与是否新内容无关 */
export function syncToastMessage(res: SyncResponse): string {
  const parts: string[] = [];
  if (res.added.length > 0) parts.push(`新增 ${res.added.length} 期`);
  if (res.updated.length > 0) parts.push(`更新 ${res.updated.length} 期`);
  if (res.unchanged.length > 0) parts.push(`核对 ${res.unchanged.length} 期未变化`);
  if (res.stagedItems > 0) parts.push(`${res.stagedItems} 条待审核`);
  if (res.failures.length > 0) parts.push(`失败 ${res.failures.length} 期`);
  return `同步完成${parts.length > 0 ? ` · ${parts.join(" · ")}` : ""}`;
}

/** POST /api/sync：增量同步（spec06 B4）。ADMIN_TOKEN 守卫生效时 403 = unauthorized（需要管理口令） */
export function triggerSync(): Promise<SyncResponse> {
  return request<SyncResponse>("/api/sync", { method: "POST" });
}

// ══════════════════════════════════════════════════════
// 搜索联想（spec11 契约 C/F）：GET /api/search/suggest?q=（公开、60s 服务端缓存）。
// ══════════════════════════════════════════════════════

/** 联想条目：snippet = summary 命中片段（服务端 summarizeMatch 截取，前后各约 40 字符） */
export interface SuggestItem {
  id: string;
  date: string;
  tag: string;
  sequenceInt: number;
  category: string;
  title: string;
  snippet: string;
}

/** 搜索联想（输入即查；q 为空串/无命中返回 { items: [] }） */
export function fetchSuggest(q: string): Promise<{ items: SuggestItem[] }> {
  const p = new URLSearchParams({ q });
  return request<{ items: SuggestItem[] }>(`/api/search/suggest?${p.toString()}`);
}

// ══════════════════════════════════════════════════════
// 审核工作流（spec10 票 03 + spec13 作业化）：四端点封装。
// 响应形状以 worker/api/parse.ts 实际交付类型为准（PendingPayload / ParseStatePayload /
// PatchOutcome / PublishOutcome，逐字段对齐），全部 requireAdmin。
// ══════════════════════════════════════════════════════

/** 归属主次（CONTEXT.md Role：primary=主导方、partner=合作方、subject=被报道对象） */
export type ReviewRole = "primary" | "partner" | "subject";

/** GET /api/review/pending 条目上的现归属（role=null = 未定主次，UI 灰显） */
export interface PendingOwner {
  companyId: string;
  name: string;
  color: string;
  role: ReviewRole | null;
}

/** 条目上的解析建议（llmModel='human-edit' = 人工编辑终版，publish 重放它） */
export interface PendingProposal {
  owners: { companyId: string; role: ReviewRole }[];
  llmModel: string;
}

/** 候选公司建议（companies.yaml 入册素材） */
export interface PendingCandidate {
  id: string;
  name: string;
  aliases: string[];
  confidence: string; // high / mid / low
  reason: string;
}

/** GET /api/review/pending 条目（candidate = source_item_id 指向该条目的首个 pending 候选） */
export interface PendingItem {
  id: string; // YYYYMMDD-N
  title: string;
  summary: string;
  category: string;
  tag: string; // #N
  owners: PendingOwner[];
  proposal: PendingProposal | null;
  candidate: PendingCandidate | null;
  /** enrich_state（spec12 契约 B 三态判定）。契约差异：worker 票 01 未交付该字段，
   *  缺省时由 isMissingOwner 以 owners 空 + 无 proposal 兜底判定（src/lib/review.ts） */
  enrichState?: "ok" | "missing_owner" | "pending";
}

export interface PendingDateGroup {
  date: string; // YYYY-MM-DD，升序
  items: PendingItem[];
}

/** 解析作业状态值（spec13 契约 C，读 D1 parse_state 单行） */
export type ParseJobStatus = "idle" | "running" | "done" | "failed";

/** 解析作业状态（spec13 契约 C）：GET /api/review/pending 载荷的 parse 字段，前端所有解析状态显示以此为准。
 *  idle 时 startedAt/finishedAt 与三个计数均为 null（worker assembleParseState 归一）；errors 恒为字符串数组 */
export interface ParseStatePayload {
  status: ParseJobStatus;
  startedAt: string | null;
  finishedAt: string | null;
  processed: number | null; // 已处理条数（running 时用于进度 k/M；idle 为 null）
  total: number | null; // 本轮圈题总数（idle 为 null）
  remaining: number | null; // 圈题池未处理余量（idle 为 null）
  errors: string[]; // 失败清单（"itemId: 原因" 字符串；作业级异常时含失败原因）
}

/** GET /api/review/pending 响应（dates 日期升序 + pending 候选全量 + 解析作业状态） */
export interface PendingPayload {
  dates: PendingDateGroup[];
  candidates: Array<PendingCandidate & { sourceItemId: string }>;
  /** 解析作业状态（spec13 契约 C）。可选兜底：旧 worker 未交付该字段时按 idle 处理 */
  parse?: ParseStatePayload;
}

/** GET /api/review/pending：暂存期 + 条目归属/建议/候选（审核页数据源） */
export function fetchPendingReview(): Promise<PendingPayload> {
  return request<PendingPayload>("/api/review/pending");
}

/** PATCH /api/review/item body：全量归属（服务端删后插；owners 非空、primary ≤1） */
export interface PatchOwnersBody {
  companyId: string;
  role: ReviewRole;
}

/** PATCH /api/review/item 响应（worker/api/parse.ts PatchOutcome） */
export interface PatchOutcome {
  itemId: string;
  owners: number;
}

/** PATCH /api/review/item：重写单条目归属（仅允许 published=0 条目） */
export function patchReviewItem(itemId: string, owners: PatchOwnersBody[]): Promise<PatchOutcome> {
  return request<PatchOutcome>("/api/review/item", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itemId, owners }),
  });
}

/** POST /api/review/publish 响应（worker/api/parse.ts PublishOutcome） */
export interface PublishOutcome {
  publishedDates: string[];
  itemsPublished: number;
}

/** POST /api/review/publish：按期入库（缺省 dates = 全部含暂存条目的日期） */
export function publishReview(dates?: string[]): Promise<PublishOutcome> {
  if (dates === undefined) {
    return request<PublishOutcome>("/api/review/publish", { method: "POST" });
  }
  return request<PublishOutcome>("/api/review/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dates }),
  });
}

/** POST /api/parse 响应（spec13 契约 B 异步作业化）：秒回启动确认 + 作业状态快照，解析本体在服务端继续 */
export interface ParseStartResponse {
  started: true;
  state: ParseStatePayload;
}

/** POST /api/parse：启动解析作业（spec13 契约 B）——秒回；另一轮在跑 → 409 { error: { code: "parse_busy" }, state } */
export function triggerParse(): Promise<ParseStartResponse> {
  return request<ParseStartResponse>("/api/parse", { method: "POST" });
}

// ══════════════════════════════════════════════════════
// 同步历史（spec12 契约 F）：GET /api/review/history（requireAdmin，不进缓存）。
// ══════════════════════════════════════════════════════

/** GET /api/review/history 行（行源 = sync_log 最近 N 条 + 逐期 LEFT JOIN items 统计） */
export interface ReviewHistory {
  date: string; // YYYY-MM-DD
  status: string; // ok / fetch_failed / parse_failed
  error: string | null; // 失败原因（status≠ok 时非空）
  attemptedAt: string; // "YYYY-MM-DD HH:MM:SS"（UTC naive，展示直接截取 MM-DD HH:mm）
  items: number; // 该期条目数（无条目期统计为 0）
  published: number; // published=1 计数
  attributed: number; // enrich_state='ok' 计数
}

/** GET /api/review/history：同步历史（审核台折叠区数据源，spec12 契约 F） */
export function fetchReviewHistory(limit = 30): Promise<{ history: ReviewHistory[] }> {
  const p = new URLSearchParams({ limit: String(limit) });
  return request<{ history: ReviewHistory[] }>(`/api/review/history?${p.toString()}`);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    // 管理口令自动附头（spec07 Step 2.2）：本地存有口令即全站请求带 x-admin-token，GET/POST 一律生效；
    // init.headers 先展开（供 POST/PATCH 带 Content-Type，spec10），token 头最后展开保证任何调用方都无法把它挤掉
    const token = getAdminToken();
    res = await fetch(path, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.headers as Record<string, string> | undefined),
        ...(token ? { "x-admin-token": token } : {}),
      },
    });
  } catch (err) {
    // AbortSignal.timeout 中止 → TimeoutError（DOMException）：与网络不可达区分提示
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new ApiError("timeout", 0, "请求超时，请稍后重试");
    }
    throw new ApiError("network", 0, "网络不可达，请检查连接后重试");
  }
  if (!res.ok) {
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      if (body?.error?.code) {
        throw new ApiError(body.error.code, res.status, body.error.message || `请求失败（HTTP ${res.status}）`);
      }
    } catch (e) {
      if (e instanceof ApiError) throw e;
    }
    throw extractError(res);
  }
  return (await res.json()) as T;
}

// read API 路由分发（spec04 A4）：5 端点 + POST /api/sync（spec06 契约扩展 2）+ GET /api/admin/ping（spec07 Step 1）+ 统一错误格式 + caches.default 包装。
// 契约（spec04「API 契约」节 + spec06「契约扩展」节，逐字段为准）：
// - 错误统一 { error: { code, message } }（400 invalid_param / 403 unauthorized / 404 daily_not_found|company_not_found|not_found / 405 method_not_allowed / 500 internal_error|sync_failed）
// - 成功响应（200）带 Cache-Control: public, max-age=60 并写入 caches.default（本地近似 no-op，读写失败不阻塞正确性）；POST /api/sync 不走缓存，GET /api/admin/ping 不走缓存（探针须每次实测）
// - 本文件属 Worker fetch 层，按 ADR-0011 不做 vitest，以 wrangler dev + curl 验收
import { REGISTRY } from "../../src/lib/registry.generated";
import { parseMarkdown } from "../../src/lib/juya";
import type { Company, Item } from "../../src/lib/schema";
import { parseArchiveDates } from "../sync/archive";
import { matchAll } from "../sync/match";
import { parseIssue } from "../sync/parse";
import { classifyWindow, selectSyncDates } from "../sync/pipeline";
import {
  companiesPruneSql,
  enrichStateUpdateSql,
  itemCompaniesUpsertSql,
  itemsUpsertSql,
  sourcesUpsertSql,
  syncLogUpsertSql,
} from "../sync/sqlgen";
import { requireAdmin } from "./auth";
import { reviewHistory } from "./history";
import { insertSyncRun, reviewSyncRuns } from "./sync-runs";
import {
  ApiError,
  reviewPatch,
  reviewPatchCandidate,
  reviewPending,
  reviewPublish,
  startParse,
} from "./parse";
import {
  DEFAULT_PAGE_LIMIT,
  MAX_BOUND_PARAMS,
  buildCompaniesIndexQuery,
  buildCompanyProfileQueries,
  buildItemsDatesQuery,
  buildItemsForDatesQuery,
  buildOwnersForItemsQuery,
  buildSuggestQuery,
  chunkArray,
  type ItemsFilters,
} from "./queries";
import { summarizeMatch } from "./suggest";
import {
  buildCategoryAggregateSql,
  buildCompanyTopSql,
  buildDailyIssuesSql,
  buildDailyItemsSql,
  buildEnrichDistributionSql,
  buildOverviewCountsSql,
  buildStatsResponse,
  buildSyncRecentSql,
  type CategoryRow,
  type CompanyTopRow,
  type DailyCountRow,
  type EnrichRow,
  type OverviewRow,
  type StatsResponse,
  type SyncRow,
} from "./stats";

export interface Env {
  DB: D1Database;
  // 同步端点 vars（与 wrangler.jsonc vars 对齐；缺省走 spec 默认值）；ADMIN_TOKEN 为可选 secret——
  // 非空时要求请求头 x-admin-token 相等，否则 403；未设置（本地 .dev.vars 不配）则开放（spec07 Step 1）
  ARCHIVE_URL?: string;
  MD_BASE?: string;
  SYNC_LOOKBACK_DAYS?: string;
  ADMIN_TOKEN?: string;
  // 解析与审核端点 vars（spec10 Step 2.2；LLM_API_KEY 为 secret，缺 key → 500 llm_not_configured）
  LLM_API_BASE?: string;
  LLM_MODEL?: string;
  LLM_API_KEY?: string;
  MAX_LLM_PER_RUN?: string;
}

const RE_DATE = /^\d{4}-\d{2}-\d{2}$/; // YYYY-MM-DD（格式级校验，历法合法性交给 D1 匹配结果）
const PAGE_LIMIT_MAX = 31; // 每页期数上限

// ---------- 错误与成功响应 ----------

/** 路由层可识别错误：统一转 { error: { code, message } } */
class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

function jsonError(status: number, code: string, message: string, extraHeaders?: HeadersInit): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

function jsonOk(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------- 缓存包装（仅 200 写入 caches.default 并带 Cache-Control） ----------

async function withCache(request: Request, handler: () => Promise<Response>): Promise<Response> {
  const cache = caches.default;
  try {
    const hit = await cache.match(request);
    if (hit) return hit;
  } catch {
    // 缓存读失败（含本地近似 no-op 场景）→ 直接回源
  }
  const res = await handler();
  if (res.status === 200) {
    res.headers.set("Cache-Control", "public, max-age=60");
    try {
      await cache.put(request, res.clone());
    } catch {
      // 缓存写失败不阻塞响应
    }
  }
  return res;
}

// ---------- 路由分发 ----------

// ctx（spec13 契约 B）：可选第三参透传——POST /api/parse 借 ctx.waitUntil 让解析作业在响应后
// 续跑；无 ctx 的调用场景回退同步执行（兼容既有调用）。
export async function handleApiRequest(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  try {
    const url = new URL(request.url);
    let pathname = url.pathname;
    if (pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.slice(0, -1);

    // 注意必须 return await：handler 内抛出的 HttpError 才会被下方 catch 捕获（裸 return promise 会逃逸）
    if (pathname === "/api/daily/latest") return await methodGuardGet(request, () => dailyLatest(env));
    if (pathname === "/api/items") return await methodGuardGet(request, () => listItems(url, env));
    if (pathname === "/api/companies") return await methodGuardGet(request, () => companiesIndex(env));
    if (pathname === "/api/search/suggest") return await methodGuardGet(request, () => searchSuggest(url, env));
    if (pathname === "/api/sync") return await syncRoute(request, env);
    if (pathname === "/api/admin/ping") return await adminPingRoute(request, env);
    // 解析与审核四端点（spec10 Step 2.3，全部 requireAdmin；GET pending 走 methodGuard 语义但
    // 不进 withCache——审核数据必须实时，四端点均不写缓存）
    // POST /api/parse（spec13 契约 B）：异步作业——启动守卫（running<10min → 409 parse_busy）、
    // 置 running 后秒回 { started: true, state }，解析本体经 ctx.waitUntil 续跑；ctx 缺省同步执行
    if (pathname === "/api/parse") {
      return await adminMethodRoute(request, env, "POST", async () => {
        const result = await startParse(env, ctx);
        if (!result.started) {
          return new Response(
            JSON.stringify({
              error: {
                code: "parse_busy",
                message: "解析作业进行中，请等待本轮完成（运行超 10 分钟视为陈旧，可重试启动）",
              },
              state: result.state,
            }),
            { status: 409, headers: { "Content-Type": "application/json" } },
          );
        }
        return jsonOk({ started: true, state: result.state });
      });
    }
    if (pathname === "/api/review/pending") {
      return await adminMethodRoute(request, env, "GET", async () => jsonOk(await reviewPending(env)));
    }
    if (pathname === "/api/review/item") {
      return await adminMethodRoute(request, env, "PATCH", async () =>
        jsonOk(await reviewPatch(env, await readJsonBody(request)))
      );
    }
    // PATCH /api/review/candidate（spec16 决策 7）：候选状态变更（标记已入册 / 忽略），
    // 只改 company_candidates.status；非法 status / 不存在的 id → 400，未授权 → 403（同款守卫）
    if (pathname === "/api/review/candidate") {
      return await adminMethodRoute(request, env, "PATCH", async () =>
        jsonOk(await reviewPatchCandidate(env, await readJsonBody(request)))
      );
    }
    if (pathname === "/api/review/publish") {
      return await adminMethodRoute(request, env, "POST", async () =>
        jsonOk(await reviewPublish(env, await readJsonBody(request)))
      );
    }
    // GET /api/review/history（spec12 契约 F）：同步历史（requireAdmin 同款守卫；不进
    // withCache——历史须实时，与解析审核四端点同策略）
    if (pathname === "/api/review/history") {
      return await adminMethodRoute(request, env, "GET", async () =>
        jsonOk(await reviewHistory(env, url.searchParams.get("limit")))
      );
    }
    // GET /api/review/sync-runs（spec14 契约 B）：同步运行记录（requireAdmin 同款守卫；不进
    // withCache——运行记录须实时，与解析审核四端点 / history 同策略）
    if (pathname === "/api/review/sync-runs") {
      return await adminMethodRoute(request, env, "GET", async () =>
        jsonOk(await reviewSyncRuns(env, url.searchParams.get("limit")))
      );
    }
    // GET /api/stats（spec08 Step 2.2）：requireAdmin + withCache 60s 的数据面板聚合
    if (pathname === "/api/stats") {
      return await statsRoute(request, env);
    }

    const dailyDate = matchPrefix(pathname, "/api/daily/");
    if (dailyDate !== null) {
      return await methodGuardGet(request, () => dailyByDate(decodeSegment(dailyDate), env));
    }
    const companyId = matchPrefix(pathname, "/api/companies/");
    if (companyId !== null) {
      return await methodGuardGet(request, () => companyProfile(decodeSegment(companyId), env));
    }
    return jsonError(404, "not_found", `未知路径：${pathname}`);
  } catch (err) {
    if (err instanceof HttpError) return jsonError(err.status, err.code, err.message);
    if (err instanceof ApiError) return jsonError(err.status, err.code, err.message);
    console.error("[api] internal error:", err);
    return jsonError(500, "internal_error", err instanceof Error ? err.message : "内部错误");
  }
}

/** 路径匹配：pathname 以 prefix 开头时返回余下段（原始编码），否则 null */
function matchPrefix(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  if (rest === "" || rest.includes("/")) return null;
  return rest;
}

function decodeSegment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new HttpError(400, "invalid_param", "路径段 URL 编码非法");
  }
}

function methodGuardGet(request: Request, handler: () => Promise<Response>): Promise<Response> {
  if (request.method !== "GET") {
    return Promise.resolve(
      jsonError(405, "method_not_allowed", `仅支持 GET（实际 ${request.method}）`, { Allow: "GET" })
    );
  }
  return withCache(request, handler);
}

// ---------- 查询参数解析（/api/items） ----------

function optParam(sp: URLSearchParams, key: string): string | undefined {
  const v = sp.get(key);
  if (v === null) return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
}

function requireDateParam(value: string | undefined, key: string): string | undefined {
  if (value === undefined) return undefined;
  if (!RE_DATE.test(value)) throw new HttpError(400, "invalid_param", `${key} 非法：须为 YYYY-MM-DD，实际 ${JSON.stringify(value)}`);
  return value;
}

function parseLimit(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === "") return undefined;
  const t = raw.trim();
  if (!/^\d+$/.test(t)) {
    throw new HttpError(400, "invalid_param", `limit 非法：须为正整数，实际 ${JSON.stringify(t)}`);
  }
  const n = Number(t);
  if (n < 1 || n > PAGE_LIMIT_MAX) {
    throw new HttpError(400, "invalid_param", `limit 非法：每页期数范围为 1..${PAGE_LIMIT_MAX}，实际 ${n}`);
  }
  return n;
}

// ---------- 端点 1/2：/api/daily/latest、/api/daily/:date ----------

interface SourceRow {
  date: string;
  markdown: string;
}

async function dailyLatest(env: Env): Promise<Response> {
  // markdown 取 sources 最新一期（queries.ts 五构造器之外的直查，SQL 极简不设构造器）；
  // published=1（spec10）：暂存期（staged 写入 published=0）对访客不可见
  const row = await env.DB.prepare("SELECT date, markdown FROM sources WHERE published = 1 ORDER BY date DESC LIMIT 1").first<SourceRow>();
  if (row === null) return jsonError(404, "daily_not_found", "暂无任何日报");
  return dailyPayload(row);
}

async function dailyByDate(date: string, env: Env): Promise<Response> {
  if (!RE_DATE.test(date)) {
    return jsonError(400, "invalid_param", `date 非法：须为 YYYY-MM-DD，实际 ${JSON.stringify(date)}`);
  }
  const row = await env.DB.prepare("SELECT date, markdown FROM sources WHERE date = ? AND published = 1").bind(date).first<SourceRow>();
  if (row === null) return jsonError(404, "daily_not_found", `该日期无日报：${date}`);
  return dailyPayload(row);
}

function dailyPayload(row: SourceRow): Response {
  const parsed = parseMarkdown(row.markdown);
  // 契约：parsed 只含 { title, coverImage?, videoLinks, overview }；coverImage 为 undefined 时 JSON 序列化自动省略
  return jsonOk({
    date: row.date,
    markdown: row.markdown,
    parsed: {
      title: parsed.title,
      coverImage: parsed.coverImage,
      videoLinks: parsed.videoLinks,
      overview: parsed.overview,
    },
  });
}

// ---------- 端点 3：/api/items ----------

interface ItemRow {
  id: string;
  date: string;
  tag: string;
  sequence_int: number;
  category: string;
  title: string;
  primary_link: string | null;
  summary: string;
  related_links: string;
  enrich_state: "ok" | "missing_owner" | "pending";
}

type OwnerRole = "primary" | "partner" | "subject";

interface OwnerRow {
  itemId: string;
  companyId: string;
  name: string;
  color: string;
  role: OwnerRole | null;
}

async function listItems(url: URL, env: Env): Promise<Response> {
  const sp = url.searchParams;
  const filters: ItemsFilters = {
    company: optParam(sp, "company"),
    category: optParam(sp, "category"),
    from: requireDateParam(optParam(sp, "from"), "from"),
    to: requireDateParam(optParam(sp, "to"), "to"),
    beforeDate: requireDateParam(optParam(sp, "before_date"), "before_date"),
    q: optParam(sp, "q"), // spec06 契约扩展 1：与 facet 可组合，进两层查询
    limit: parseLimit(sp.get("limit")),
  };

  // 第一层：期集合
  const datesQ = buildItemsDatesQuery(filters);
  const dateRows = await env.DB.prepare(datesQ.sql).bind(...datesQ.params).all<{ date: string }>();
  const dates = dateRows.results.map((r) => r.date);
  if (dates.length === 0) return jsonOk({ items: [], nextBeforeDate: null });

  // 第二层：期内条目
  const itemsQ = buildItemsForDatesQuery(dates, filters);
  const itemRows = await env.DB.prepare(itemsQ.sql).bind(...itemsQ.params).all<ItemRow>();

  // 第三层：归属（分块防 D1 单查询 100 绑定参数上限）
  const ownerRows: OwnerRow[] = [];
  for (const chunk of chunkArray(itemRows.results.map((r) => r.id), MAX_BOUND_PARAMS)) {
    const ownersQ = buildOwnersForItemsQuery(chunk);
    const res = await env.DB.prepare(ownersQ.sql).bind(...ownersQ.params).all<OwnerRow>();
    ownerRows.push(...res.results);
  }
  const ownersByItem = new Map<
    string,
    { company: string; name: string; color: string; role: OwnerRole | null }[]
  >();
  for (const r of ownerRows) {
    const list = ownersByItem.get(r.itemId) ?? [];
    list.push({ company: r.companyId, name: r.name, color: r.color, role: r.role });
    ownersByItem.set(r.itemId, list);
  }

  const items = itemRows.results.map((r) => ({
    id: r.id,
    date: r.date,
    tag: r.tag,
    sequenceInt: Number(r.sequence_int),
    category: r.category,
    title: r.title,
    primaryLink: r.primary_link ?? null,
    summary: r.summary,
    relatedLinks: parseJsonStringArray(r.related_links),
    enrichState: r.enrich_state,
    // 契约：owners 按 company id 排序；role=primary/partner/subject（spec09 裁决回填），单家归属为 null（ADR-0015）
    owners: (ownersByItem.get(r.id) ?? []).sort(byCompany),
  }));

  // 本页期数 == limit → nextBeforeDate = 本页最早期日；< limit → 到底
  const effectiveLimit = filters.limit ?? DEFAULT_PAGE_LIMIT;
  const nextBeforeDate = dates.length >= effectiveLimit ? dates[dates.length - 1] : null;
  return jsonOk({ items, nextBeforeDate });
}

function byCompany(
  a: { company: string },
  b: { company: string }
): number {
  return a.company < b.company ? -1 : a.company > b.company ? 1 : 0;
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

// ---------- 端点 3.5：/api/search/suggest（spec11 契约 C，公开、60s 缓存） ----------

interface SuggestRow {
  id: string;
  date: string;
  tag: string;
  sequenceInt: number;
  category: string;
  title: string;
  summary: string;
}

async function searchSuggest(url: URL, env: Env): Promise<Response> {
  const q = optParam(url.searchParams, "q");
  if (q === undefined) return jsonOk({ items: [] });
  const suggestQ = buildSuggestQuery(q, 8);
  const rows = await env.DB.prepare(suggestQ.sql).bind(...suggestQ.params).all<SuggestRow>();
  return jsonOk({
    items: rows.results.map((r) => ({
      id: r.id,
      date: r.date,
      tag: r.tag,
      sequenceInt: Number(r.sequenceInt),
      category: r.category,
      title: r.title,
      snippet: summarizeMatch(r.summary, q),
    })),
  });
}

// ---------- 端点 4：/api/companies ----------

interface CompanyIndexRow {
  id: string;
  name: string;
  color: string;
  notes: string;
  aliases: string; // JSON 数组字面量
  status: string;
  total: number;
  last30d: number;
  lastEventDate: string | null;
}

async function companiesIndex(env: Env): Promise<Response> {
  const q = buildCompaniesIndexQuery({ last30dFrom: isoDaysAgo(30) });
  const rows = await env.DB.prepare(q.sql).bind(...q.params).all<CompanyIndexRow>();
  const companies = rows.results.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    notes: r.notes,
    aliases: parseJsonStringArray(r.aliases),
    status: r.status,
    stats: {
      total: Number(r.total),
      last30d: Number(r.last30d),
      lastEventDate: r.lastEventDate ?? null,
    },
  }));
  return jsonOk({ companies });
}

// ---------- 端点 5：/api/companies/:id ----------

interface CompanyRow {
  id: string;
  name: string;
  color: string;
  notes: string;
  aliases: string;
  status: string;
}

interface CompanyStatsRow {
  total: number;
  last30d: number;
  lastEventDate: string | null;
  earliest: string | null;
  latest: string | null;
}

async function companyProfile(companyId: string, env: Env): Promise<Response> {
  const q = buildCompanyProfileQueries(companyId, { last30dFrom: isoDaysAgo(30) });
  const companyRow = await env.DB.prepare(q.company.sql).bind(...q.company.params).first<CompanyRow>();
  if (companyRow === null) return jsonError(404, "company_not_found", `公司不存在：${companyId}`);

  const statsRow = await env.DB.prepare(q.stats.sql).bind(...q.stats.params).first<CompanyStatsRow>();
  const catRows = await env.DB.prepare(q.categoryDistribution.sql)
    .bind(...q.categoryDistribution.params)
    .all<{ category: string; count: number }>();
  const coworkRows = await env.DB.prepare(q.coworkers.sql)
    .bind(...q.coworkers.params)
    .all<{ companyId: string; name: string; color: string; count: number }>();

  const categoryDistribution: Record<string, number> = {};
  for (const r of catRows.results) categoryDistribution[r.category] = Number(r.count);

  const stats = statsRow ?? { total: 0, last30d: 0, lastEventDate: null, earliest: null, latest: null };
  return jsonOk({
    company: {
      id: companyRow.id,
      name: companyRow.name,
      color: companyRow.color,
      notes: companyRow.notes,
      aliases: parseJsonStringArray(companyRow.aliases),
      status: companyRow.status,
    },
    stats: {
      total: Number(stats.total),
      last30d: Number(stats.last30d),
      lastEventDate: stats.lastEventDate ?? null,
      categoryDistribution,
      coworkers: coworkRows.results.map((r) => ({
        companyId: r.companyId,
        name: r.name,
        color: r.color,
        count: Number(r.count),
      })),
      timeSpan: { earliest: stats.earliest ?? null, latest: stats.latest ?? null },
    },
  });
}

// ---------- 端点 6：POST /api/sync（spec06 契约扩展 2，ADR-0013 端点化）----------

// 与 scripts/sync.ts 同一纯函数与 SQL 生成（selectSyncDates / parseIssue / matchAll / sqlgen 全家）；
// I/O 差异仅两处：D1 读写经 binding（全字面量 SQL 经 prepare+batch 执行，无绑定参数），抓取走 Worker 原生 fetch。
// 增量窗口通常 ≤4 期（SYNC_LOOKBACK_DAYS 默认 3）；全量场景由 backfill 承担——端点不提供全量模式。
// 单期容错同脚本：失败期仅 sync_log（fetch_failed/parse_failed），不阻塞后续期（ADR-0008）。
// 每次运行批尾执行 companiesPruneSql（registry 镜像删除语义，ADR-0001）。
// spec15 票 01 分界：runSyncCore = 同步核心（流水线 + sync_runs 落库 + 结构化摘要，抛普通 Error，
// 不含 HTTP 语义，供手动端点与定时任务共用）；syncNow = 薄壳（摘要 → 既有响应契约 + HTTP 错误映射）。

const SYNC_CONCURRENCY = 3; // 与 scripts/sync.ts 同值：并发抓取
const SYNC_FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_ARCHIVE_URL = "https://daily.juya.uk/archive/";
const DEFAULT_MD_BASE = "https://daily.juya.uk/markdown";

type IssueOutcome =
  | { date: string; ok: true; parsedDate: string; markdown: string; items: Item[] }
  | { date: string; ok: false; status: "fetch_failed" | "parse_failed"; error: string };

function syncVars(env: Env): { archiveUrl: string; mdBase: string; lookbackDays: number } {
  const lookbackRaw = Number(env.SYNC_LOOKBACK_DAYS ?? "3");
  return {
    archiveUrl: env.ARCHIVE_URL ?? DEFAULT_ARCHIVE_URL,
    mdBase: env.MD_BASE ?? DEFAULT_MD_BASE,
    lookbackDays: Number.isFinite(lookbackRaw) && lookbackRaw >= 0 ? lookbackRaw : 3,
  };
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": "juya-daily-sync/1.0 (worker incremental sync; zero-login)" },
    signal: AbortSignal.timeout(SYNC_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// 固定并发池（与 scripts/sync.ts 同构）：按 next++ 依序领取，结果按下标回填，保持与输入同序。
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

// fetch 失败重试 1 次；parse 失败是确定性失败不重试（同一输入必然同样抛错，同 scripts/sync.ts）。
async function fetchOneIssue(date: string, mdBase: string): Promise<IssueOutcome> {
  let lastFetchError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const markdown = await fetchText(`${mdBase}/${date}.md`);
      try {
        const parsed = parseIssue(markdown); // 无日期标题 → 抛错
        return { date, ok: true, parsedDate: parsed.date, markdown, items: parsed.items };
      } catch (err) {
        return { date, ok: false, status: "parse_failed", error: err instanceof Error ? err.message : String(err) };
      }
    } catch (err) {
      lastFetchError = err instanceof Error ? err.message : String(err);
      if (attempt === 1) await sleep(800);
    }
  }
  return { date, ok: false, status: "fetch_failed", error: lastFetchError };
}

interface SyncCompanyRow {
  id: string;
  name: string;
  aliases: string; // JSON 数组字面量
  color: string;
  status: string;
  notes: string;
}

/** 同步核心摘要（spec15 票 01）：一次同步运行的结果，HTTP 响应与 sync_runs 记录同源 */
export interface SyncSummary {
  dates: string[]; // 实际写入的期（成功期，升序 = 执行序）
  stagedDates: string[]; // 同步执行后 items.published=0 的期
  stagedItems: number; // 同步执行后 published=0 条目总数
  added: string[]; // 三分类：不在库（新增）
  updated: string[]; // 三分类：内容有变（更新）
  unchanged: string[]; // 三分类：内容相同（未变化）
  failures: { date: string; error: string }[]; // 失败期与错误消息
  durationMs: number; // 核心函数起止实测耗时
}

// 同步核心（spec15 票 01）：手动端点与定时任务的唯一同步实现；抛普通 Error，HTTP 语义由薄壳映射。
export async function runSyncCore(env: Env): Promise<SyncSummary> {
  // spec14 契约 B：函数起点计时（duration_ms 实测口径）与 started_at（ISO now）；
  // 成功路径返回前落 sync_runs 一行运行记录（异常路径不落——表语义为「运行完成的摘要」）。
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const { archiveUrl, mdBase, lookbackDays } = syncVars(env);

  // 1) 窗口：max(items.date)（经 binding）→ archive 期列表 → selectSyncDates（pipeline 纯函数）。
  // archive 抓取是单点（无逐期容错可比），超时/网络抖动重试 1 次（同 fetchOneIssue 节奏）——
  // 20260903 实测源站抖动时 archive 30s 超时直接 500，两次均失败才向上抛。
  let archiveText = "";
  let archiveError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      archiveText = await fetchText(archiveUrl);
      archiveError = "";
      break;
    } catch (err) {
      archiveError = err instanceof Error ? err.message : String(err);
      if (attempt === 1) await sleep(800);
    }
  }
  if (archiveText === "") {
    throw new Error(`归档页抓取失败（已重试）：${archiveError}`);
  }
  const maxRow = await env.DB.prepare("SELECT MAX(date) AS m FROM items").first<{ m: string | null }>();
  const archiveDates = parseArchiveDates(archiveText);
  if (archiveDates.length === 0) {
    throw new Error("archive 页未解析到任何期日期");
  }
  const dates = selectSyncDates(archiveDates, maxRow?.m ?? null, lookbackDays);

  // 2) companies 镜像（经 binding 读）→ 段一匹配 registry（同 scripts/sync.ts / match-all）
  const companyRows = await env.DB.prepare(
    "SELECT id, name, aliases, color, status, notes FROM companies ORDER BY id",
  ).all<SyncCompanyRow>();
  const registry: Company[] = companyRows.results.map((c) => ({
    id: c.id,
    name: c.name,
    aliases: JSON.parse(c.aliases) as string[],
    color: c.color,
    status: c.status as Company["status"],
    notes: c.notes,
  }));

  // 3) 并发抓取 + 解析 + SQL 累积（成功期五件套；失败期仅 sync_log）
  // batch 的每个元素须恰为一条完整语句：enrichStateUpdateSql / companiesPruneSql 产物是
  // 「单语句单行 × N」以 \n 连接，按 \n 拆分安全；其余生成器各为单语句，
  // 字面量内换行（markdown 正文）随语句整体交给 prepare 引号感知解析。
  // spec10：sources/items 一律 staged 写入（published=0，人工审核 publish 后才对访客可见）；
  // matchAll / registry 镜像 / enrich_state 回写语义不变。
  const synced: string[] = [];
  const failures: { date: string; error: string }[] = [];
  const statements: string[] = [];
  const outcomes = await mapPool(dates, SYNC_CONCURRENCY, (d) => fetchOneIssue(d, mdBase));
  // 消息诚实化：抓取完成后、写库前，取窗口期在库现存的 markdown 做三分类（新增/有更新/未变化）。
  // 只影响响应口径与提示语；写库行为不变（每期照常重匹配，注册新公司后点同步仍能补归属）。
  const okOutcomes = outcomes.filter((o) => o.ok);
  const existingMarkdown = new Map<string, string>();
  if (okOutcomes.length > 0) {
    const placeholders = okOutcomes.map(() => "?").join(", ");
    const existingRows = await env.DB.prepare(
      `SELECT date, markdown FROM sources WHERE date IN (${placeholders})`,
    )
      .bind(...okOutcomes.map((o) => o.parsedDate))
      .all<{ date: string; markdown: string }>();
    for (const r of existingRows.results) existingMarkdown.set(r.date, r.markdown);
  }
  // 暂存期集合（写库前取，二轮补正：在库但 published=0 的期归入「新增」而非「未变化」）
  const stagedBeforeRows = await env.DB.prepare(
    "SELECT DISTINCT date FROM items WHERE published = 0",
  ).all<{ date: string }>();
  const stagedBefore = new Set(stagedBeforeRows.results.map((r) => r.date));
  const { added, updated, unchanged } = classifyWindow(
    okOutcomes.map((o) => ({ date: o.parsedDate, markdown: o.markdown })),
    existingMarkdown,
    stagedBefore,
  );
  for (const o of outcomes) {
    if (!o.ok) {
      failures.push({ date: o.date, error: o.error });
      statements.push(syncLogUpsertSql(o.date, o.status, o.error));
      continue;
    }
    const { ownerRows, okIds, missingIds } = matchAll(o.items, registry);
    statements.push(
      sourcesUpsertSql(o.parsedDate, o.markdown, { staged: true }),
      itemsUpsertSql(o.items, { staged: true }),
      itemCompaniesUpsertSql(ownerRows),
      ...enrichStateUpdateSql(okIds, missingIds).split("\n").filter((s) => s !== ""),
      syncLogUpsertSql(o.date, "ok", ""),
    );
    synced.push(o.date);
  }
  // registry 镜像 prune 每次运行都执行（spec06 契约扩展 3），置于批尾
  statements.push(...companiesPruneSql(REGISTRY.map((c) => c.id)).split("\n").filter((s) => s !== ""));

  // 4) 全字面量 SQL 经 binding 执行（无绑定参数）。注意不用 env.DB.exec——它按裸换行拆分语句，
  // 会把 markdown 字面量内的换行误判为语句边界（实测 D1_EXEC_ERROR）；prepare 引号感知解析完整语句，
  // batch 保序执行（隐式事务，部分失败整体回滚）。
  const batch = statements.filter((s) => s !== "").map((s) => env.DB.prepare(s));
  if (batch.length > 0) await env.DB.batch(batch);

  // 摘要契约（薄壳逐字段映射进响应；ok = 窗口内全部成功由薄壳按 failures 计算）：
  // dates = 实际写入的期（成功期，升序 = 执行序）；
  // stagedDates = 同步执行后 items.published=0 的期（真有暂存的权威口径，spec11 契约 A——
  // 重同步已发布期时不再误报「待审核」）；stagedItems = published=0 条目总数（spec12 契约 A，
  // 与 stagedDates 同源：一条 GROUP BY 同时取 DISTINCT date 与逐期计数，总数 = 逐期 cnt 求和）；
  // added/updated/unchanged = 窗口三分类（消息诚实化：不在库/内容有变/内容相同）；
  // failures = 失败期与错误消息（与 dates 划分整个窗口）
  const stagedRows = await env.DB.prepare(
    "SELECT date, COUNT(*) AS cnt FROM items WHERE published = 0 GROUP BY date ORDER BY date ASC",
  ).all<{ date: string; cnt: number }>();
  const stagedDates = stagedRows.results.map((r) => r.date);
  const stagedItems = stagedRows.results.reduce((acc, r) => acc + Number(r.cnt), 0);

  // spec14 契约 B：返回前落一行 sync_runs 运行记录（窗口 / 三分类 / 失败 JSON 化，
  // duration_ms 为函数起止实测，ok = failures.length === 0 → 1/0）
  const durationMs = Date.now() - startedMs;
  await insertSyncRun(env, {
    startedAt,
    durationMs,
    windowDates: dates,
    added,
    updated,
    unchanged,
    failures,
    stagedItems,
  });

  return {
    dates: synced,
    stagedDates,
    stagedItems,
    added,
    updated,
    unchanged,
    failures,
    durationMs,
  };
}

// 薄壳（spec15 票 01）：摘要 → 既有响应契约；HTTP 错误映射（普通 Error → 500 sync_failed）留在此层。
// 注：核心当前只抛普通 Error（无 HttpError），故 catch 不做 rethrow；若未来核心引入 HttpError 语义，
// 这里需恢复 `if (err instanceof HttpError) throw err`，否则具体状态码会被压成 500。
async function syncNow(env: Env): Promise<Response> {
  try {
    const summary = await runSyncCore(env);
    return jsonOk({
      ok: summary.failures.length === 0,
      dates: summary.dates,
      stagedDates: summary.stagedDates,
      stagedItems: summary.stagedItems,
      added: summary.added,
      updated: summary.updated,
      unchanged: summary.unchanged,
      failures: summary.failures,
    });
  } catch (err) {
    throw new HttpError(500, "sync_failed", err instanceof Error ? err.message : String(err));
  }
}

/** 守卫：ADMIN_TOKEN 非空时要求 x-admin-token 相等，否则 403 unauthorized；未设置则开放（spec07 Step 1 统一） */
function syncRoute(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return Promise.resolve(
      jsonError(405, "method_not_allowed", `仅支持 POST（实际 ${request.method}）`, { Allow: "POST" })
    );
  }
  if (!requireAdmin(env.ADMIN_TOKEN, request.headers.get("x-admin-token"))) {
    return Promise.resolve(jsonError(403, "unauthorized", "缺少或错误的管理口令（x-admin-token 请求头）"));
  }
  return syncNow(env);
}

// ---------- 端点 7：GET /api/admin/ping（spec07 Step 1.3，口令验证探针）----------

// 与 syncRoute 同款 requireAdmin 守卫，但不进 withCache：探针必须每次实测，不吃 60s 缓存。
function adminPingRoute(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") {
    return Promise.resolve(
      jsonError(405, "method_not_allowed", `仅支持 GET（实际 ${request.method}）`, { Allow: "GET" })
    );
  }
  if (!requireAdmin(env.ADMIN_TOKEN, request.headers.get("x-admin-token"))) {
    return Promise.resolve(jsonError(403, "unauthorized", "缺少或错误的管理口令（x-admin-token 请求头）"));
  }
  return Promise.resolve(jsonOk({ ok: true }));
}

// ---------- 端点 8：GET /api/stats（spec08 Step 2.2，数据面板聚合）----------

// 与 syncRoute/adminPingRoute 同款守卫风格：method 守卫 → requireAdmin → withCache。
// requireAdmin 先于 withCache：未授权请求不触碰缓存（403 永不写缓存，且不读他人写入的 200 条目）。
function statsRoute(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") {
    return Promise.resolve(
      jsonError(405, "method_not_allowed", `仅支持 GET（实际 ${request.method}）`, { Allow: "GET" })
    );
  }
  if (!requireAdmin(env.ADMIN_TOKEN, request.headers.get("x-admin-token"))) {
    return Promise.resolve(jsonError(403, "unauthorized", "缺少或错误的管理口令（x-admin-token 请求头）"));
  }
  return withCache(request, () => statsData(env));
}

// 窗口锚点：daily 近 90 天（含今天 → 今天-89）、sync 近 84 天（热力图 12 周 → 今天-83）；
// 锚点由调用方注入构造器（stats.ts 纯函数便于测试）
async function statsData(env: Env): Promise<Response> {
  const overviewQ = buildOverviewCountsSql();
  const overviewRow = await env.DB.prepare(overviewQ.sql)
    .bind(...overviewQ.params)
    .first<OverviewRow>();

  const dailyFrom = isoDaysAgo(89);
  const itemsQ = buildDailyItemsSql(dailyFrom);
  const itemDaily = await env.DB.prepare(itemsQ.sql).bind(...itemsQ.params).all<DailyCountRow>();
  const issuesQ = buildDailyIssuesSql(dailyFrom);
  const issueDaily = await env.DB.prepare(issuesQ.sql).bind(...issuesQ.params).all<DailyCountRow>();

  const categoriesQ = buildCategoryAggregateSql();
  const categories = await env.DB.prepare(categoriesQ.sql)
    .bind(...categoriesQ.params)
    .all<CategoryRow>();

  const companyTopQ = buildCompanyTopSql();
  const companyTop = await env.DB.prepare(companyTopQ.sql)
    .bind(...companyTopQ.params)
    .all<CompanyTopRow>();

  const enrichQ = buildEnrichDistributionSql();
  const enrich = await env.DB.prepare(enrichQ.sql).bind(...enrichQ.params).all<EnrichRow>();

  const syncQ = buildSyncRecentSql(isoDaysAgo(83), isoDaysAgo(0));
  const sync = await env.DB.prepare(syncQ.sql).bind(...syncQ.params).all<SyncRow>();

  const stats: StatsResponse = buildStatsResponse({
    // 标量子查询 SELECT 恒返回一行；?? 兜底对齐 companyProfile 既有写法
    overview: overviewRow ?? { issues: 0, items: 0, companies: 0, attributed: 0, lastSyncAt: null },
    itemDaily: itemDaily.results,
    issueDaily: issueDaily.results,
    categories: categories.results,
    companyTop: companyTop.results,
    enrich: enrich.results,
    sync: sync.results,
  });
  return jsonOk(stats);
}

// ---------- 工具 ----------

/** 守卫端点通用骨架（spec10 解析与审核四端点）：method 守卫 + requireAdmin，不进 withCache（实时数据） */
async function adminMethodRoute(
  request: Request,
  env: Env,
  method: string,
  handler: () => Promise<Response>
): Promise<Response> {
  if (request.method !== method) {
    return jsonError(405, "method_not_allowed", `仅支持 ${method}（实际 ${request.method}）`, {
      Allow: method,
    });
  }
  if (!requireAdmin(env.ADMIN_TOKEN, request.headers.get("x-admin-token"))) {
    return jsonError(403, "unauthorized", "缺少或错误的管理口令（x-admin-token 请求头）");
  }
  return handler();
}

/** 读 JSON body：空 body → undefined（publish 缺省全日期语义）；非法 JSON → 400 invalid_param */
async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_param", "body 非法 JSON");
  }
}

/** UTC 口径的 N 天前日期（YYYY-MM-DD）；last30d 统计窗口锚点 */
function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

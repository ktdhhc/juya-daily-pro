// read API 路由分发（spec04 A4）：5 端点 + 统一错误格式 + caches.default 包装。
// 契约（spec04「API 契约」节，逐字段为准）：
// - 错误统一 { error: { code, message } }（400 invalid_param / 404 daily_not_found|company_not_found|not_found / 405 method_not_allowed / 500 internal_error）
// - 成功响应（200）带 Cache-Control: public, max-age=60 并写入 caches.default（本地近似 no-op，读写失败不阻塞正确性）
// - 本文件属 Worker fetch 层，按 ADR-0011 不做 vitest，以 wrangler dev + curl 验收
import { parseMarkdown } from "../../src/lib/juya";
import {
  DEFAULT_PAGE_LIMIT,
  MAX_BOUND_PARAMS,
  buildCompaniesIndexQuery,
  buildCompanyProfileQueries,
  buildItemsDatesQuery,
  buildItemsForDatesQuery,
  buildOwnersForItemsQuery,
  chunkArray,
  type ItemsFilters,
} from "./queries";

export interface Env {
  DB: D1Database;
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

export async function handleApiRequest(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    let pathname = url.pathname;
    if (pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.slice(0, -1);

    // 注意必须 return await：handler 内抛出的 HttpError 才会被下方 catch 捕获（裸 return promise 会逃逸）
    if (pathname === "/api/daily/latest") return await methodGuardGet(request, () => dailyLatest(env));
    if (pathname === "/api/items") return await methodGuardGet(request, () => listItems(url, env));
    if (pathname === "/api/companies") return await methodGuardGet(request, () => companiesIndex(env));

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
  // markdown 取 sources 最新一期（queries.ts 五构造器之外的直查，SQL 极简不设构造器）
  const row = await env.DB.prepare("SELECT date, markdown FROM sources ORDER BY date DESC LIMIT 1").first<SourceRow>();
  if (row === null) return jsonError(404, "daily_not_found", "暂无任何日报");
  return dailyPayload(row);
}

async function dailyByDate(date: string, env: Env): Promise<Response> {
  if (!RE_DATE.test(date)) {
    return jsonError(400, "invalid_param", `date 非法：须为 YYYY-MM-DD，实际 ${JSON.stringify(date)}`);
  }
  const row = await env.DB.prepare("SELECT date, markdown FROM sources WHERE date = ?").bind(date).first<SourceRow>();
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

interface OwnerRow {
  itemId: string;
  companyId: string;
  name: string;
  color: string;
}

async function listItems(url: URL, env: Env): Promise<Response> {
  const sp = url.searchParams;
  const filters: ItemsFilters = {
    company: optParam(sp, "company"),
    category: optParam(sp, "category"),
    from: requireDateParam(optParam(sp, "from"), "from"),
    to: requireDateParam(optParam(sp, "to"), "to"),
    beforeDate: requireDateParam(optParam(sp, "before_date"), "before_date"),
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
  const ownersByItem = new Map<string, { company: string; name: string; color: string }[]>();
  for (const r of ownerRows) {
    const list = ownersByItem.get(r.itemId) ?? [];
    list.push({ company: r.companyId, name: r.name, color: r.color });
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
    // 契约：owners 按 company id 排序，无 role（ADR-0014）
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

// ---------- 工具 ----------

/** UTC 口径的 N 天前日期（YYYY-MM-DD）；last30d 统计窗口锚点 */
function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

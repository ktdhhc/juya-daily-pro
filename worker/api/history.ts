// history — spec12 契约 F：GET /api/review/history 的纯函数层 + 薄 IO 编排。
// 行源 = sync_log 最近 limit 条（attempted_at 倒序），逐期 LEFT JOIN items 统计
//（条目数 / published=1 计数 / enrich_state='ok' 计数），assembleHistory 合并，无条目期补零。
// 纯函数（parseHistoryLimit / buildHistoryQuery / buildHistoryStatsQuery / assembleHistory）
// 进 vitest（worker/api/history.test.ts，先红后绿）；D1 读写为薄 IO 不单测（ADR-0011），
// 以 wrangler dev + curl 验收。路由挂载见 routes.ts（requireAdmin 同款守卫，不进 withCache——历史须实时）。
import { chunkArray, MAX_BOUND_PARAMS } from "./queries";

// ---------- env（routes.ts Env 的结构子集） ----------

export interface HistoryEnv {
  DB: D1Database;
}

// ---------- 行类型（syncRows = SQL 行原样；statRows = GROUP BY 聚合行） ----------

export interface HistorySyncRow {
  date: string;
  status: string;
  error: string | null;
  attemptedAt: string | null;
}

export interface HistoryStatRow {
  date: string;
  items: number;
  published: number;
  attributed: number;
}

export interface HistoryEntry {
  date: string;
  status: string;
  error: string | null;
  attemptedAt: string | null;
  items: number;
  published: number;
  attributed: number;
}

// ---------- limit 解析（spec12 契约 F：缺省 30，上限 100，非法回退 30） ----------

export const HISTORY_LIMIT_DEFAULT = 30;
export const HISTORY_LIMIT_MAX = 100;

export function parseHistoryLimit(raw: string | null): number {
  const t = raw?.trim() ?? "";
  if (!/^\d+$/.test(t)) return HISTORY_LIMIT_DEFAULT;
  const n = Number(t);
  if (n < 1) return HISTORY_LIMIT_DEFAULT;
  return Math.min(n, HISTORY_LIMIT_MAX);
}

// ---------- 查询构造器（纯函数） ----------

// sync_log 行源：最近 limit 条按 attempted_at 倒序（LIMIT 走绑定参数）
export function buildHistoryQuery(limit: number): { sql: string; params: number[] } {
  return {
    sql:
      "SELECT date, status, error_message AS error, attempted_at AS attemptedAt" +
      " FROM sync_log ORDER BY attempted_at DESC LIMIT ?",
    params: [limit],
  };
}

// 逐期 items 统计：条目数、published=1 计数、enrich_state='ok' 计数（一条 GROUP BY）。
// date IN 走绑定参数——limit 上限 100 > MAX_BOUND_PARAMS(90)，调用方须先分块。
export function buildHistoryStatsQuery(dates: string[]): { sql: string; params: string[] } {
  const placeholders = dates.map(() => "?").join(",");
  return {
    sql:
      "SELECT date, COUNT(*) AS items, SUM(published) AS published," +
      " SUM(CASE WHEN enrich_state = 'ok' THEN 1 ELSE 0 END) AS attributed" +
      ` FROM items WHERE date IN (${placeholders}) GROUP BY date`,
    params: [...dates],
  };
}

// ---------- 组装纯函数 ----------

// D1 聚合数值归一：COUNT/SUM 理论上恒为非负整数，防御性容忍 string/null/负值等异常输入
//（spec12 票 12-01：条目数负值/异常输入不炸）——非有限数或负值归 0，正数向下取整
function statCount(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// 合并 syncRows（SQL 已按 attempted_at 倒序）与 statRows：
// - 输出保持 syncRows 行序（倒序保持，不按 date 重排）；
// - 无条目期（sync_log 有行而 items 无统计）items/published/attributed 补 0；
// - 孤儿统计（statRows 有而 syncRows 无的 date）忽略（LEFT JOIN 语义：sync 侧为驱动表）。
export function assembleHistory(
  syncRows: HistorySyncRow[],
  statRows: HistoryStatRow[],
): HistoryEntry[] {
  const statByDate = new Map<string, HistoryStatRow>();
  for (const s of statRows) statByDate.set(s.date, s);
  return syncRows.map((r) => {
    const s = statByDate.get(r.date);
    return {
      date: r.date,
      status: r.status,
      error: r.error ?? null,
      attemptedAt: r.attemptedAt ?? null,
      items: statCount(s?.items),
      published: statCount(s?.published),
      attributed: statCount(s?.attributed),
    };
  });
}

// ---------- 薄 IO：GET /api/review/history（routes.ts 挂载） ----------

export async function reviewHistory(
  env: HistoryEnv,
  rawLimit: string | null,
): Promise<{ history: HistoryEntry[] }> {
  const limitQ = buildHistoryQuery(parseHistoryLimit(rawLimit));
  const syncRes = await env.DB.prepare(limitQ.sql).bind(...limitQ.params).all<HistorySyncRow>();
  const dates = syncRes.results.map((r) => r.date);

  // 统计查询分块（date 数可达 100 > MAX_BOUND_PARAMS(90)，同 reviewPending 分块范式）
  const statRows: HistoryStatRow[] = [];
  for (const chunk of chunkArray(dates, MAX_BOUND_PARAMS)) {
    const statQ = buildHistoryStatsQuery(chunk);
    const statRes = await env.DB.prepare(statQ.sql).bind(...statQ.params).all<HistoryStatRow>();
    statRows.push(...statRes.results);
  }
  return { history: assembleHistory(syncRes.results, statRows) };
}

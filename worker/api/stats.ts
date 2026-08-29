// GET /api/stats 纯 SQL 构造器 + 响应组装器（spec08 Step 2.1）。
// 风格对齐 queries.ts：构造器只组装 { sql, params }，不做校验/不做 I/O；窗口锚点（daily 近 90 天、
// sync 近 84 天的 from 日期）由调用方（routes.ts）注入便于测试。
// published=1（spec10 暂存语义修订）：stats 聚合只统计已发布数据——items 侧一律加 published = 1
// 字面量过滤（daily 聚合、categories、companies Top 的 JOIN 侧、enrich 分布、overview 的 items/
// attributed 子查询），sources/issues 计数同加；sync_log 不过滤（同步日志与发布态无关）。
// published 为字面量过滤，不占绑定参数。
// 组装器（buildStatsResponse）负责数值收敛：D1 计数可能回字符串，一律 Number()；sync 行
// error_message→error（空串→null）。
// 消费方式：env.DB.prepare(stmt.sql).bind(...stmt.params)。
import type { SqlStatement } from "./queries";

// ---------- 行类型（D1 .all<T>()/.first<T>() 的行形状；计数以 number | string 容「字符串计数」） ----------

export interface OverviewRow {
  issues: number | string;
  items: number | string;
  companies: number | string;
  attributed: number | string;
  lastSyncAt: string | null;
}

export interface DailyCountRow {
  date: string;
  count: number | string;
}

export interface CategoryRow {
  category: string;
  count: number | string;
}

export interface CompanyTopRow {
  companyId: string;
  name: string;
  count: number | string;
}

export interface EnrichRow {
  enrichState: string;
  count: number | string;
}

export interface SyncRow {
  date: string;
  status: string;
  errorMessage: string | null;
}

// ---------- 1. 总览：单行五值（attributedRate 由组装器派生，不入 SQL） ----------

export function buildOverviewCountsSql(): SqlStatement {
  return {
    sql:
      "SELECT" +
      " (SELECT COUNT(*) FROM sources WHERE published = 1) AS issues," +
      " (SELECT COUNT(*) FROM items WHERE published = 1) AS items," +
      " (SELECT COUNT(*) FROM companies) AS companies," +
      " (SELECT COUNT(*) FROM items WHERE published = 1 AND enrich_state = 'ok') AS attributed," +
      " (SELECT MAX(attempted_at) FROM sync_log WHERE status = 'ok') AS lastSyncAt",
    params: [],
  };
}

// ---------- 2. 按日计数（daily 折线两源） ----------

/** items 按日计数（仅 published=1）：date >= ? 绑定参数，升序 */
export function buildDailyItemsSql(from: string): SqlStatement {
  return {
    sql:
      "SELECT i.date AS date, COUNT(*) AS count" +
      " FROM items i" +
      " WHERE i.date >= ? AND i.published = 1" +
      " GROUP BY i.date" +
      " ORDER BY i.date ASC",
    params: [from],
  };
}

/** sources 按日计数（仅 published=1）：date >= ? 绑定参数，升序 */
export function buildDailyIssuesSql(from: string): SqlStatement {
  return {
    sql:
      "SELECT s.date AS date, COUNT(*) AS count" +
      " FROM sources s" +
      " WHERE s.date >= ? AND s.published = 1" +
      " GROUP BY s.date" +
      " ORDER BY s.date ASC",
    params: [from],
  };
}

/** 按日合并 items/issues 两源：仅取两源并集日期（两源皆无的日期不出现），缺侧补 0，日期升序 */
export function mergeDaily(itemRows: DailyCountRow[], issueRows: DailyCountRow[]): DailyPoint[] {
  const byDate = new Map<string, DailyPoint>();
  for (const r of itemRows) {
    byDate.set(r.date, { date: r.date, items: Number(r.count), issues: 0 });
  }
  for (const r of issueRows) {
    const hit = byDate.get(r.date);
    if (hit) {
      hit.issues = Number(r.count);
    } else {
      byDate.set(r.date, { date: r.date, items: 0, issues: Number(r.count) });
    }
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export interface DailyPoint {
  date: string;
  items: number;
  issues: number;
}

// ---------- 3. 分类分布（墨条一） ----------

/** category 非空分组计数，count 倒序 + category 稳定序；仅 published=1 */
export function buildCategoryAggregateSql(): SqlStatement {
  return {
    sql:
      "SELECT i.category AS category, COUNT(*) AS count" +
      " FROM items i" +
      " WHERE i.published = 1 AND i.category != ''" +
      " GROUP BY i.category" +
      " ORDER BY count DESC, category ASC",
    params: [],
  };
}

// ---------- 4. 公司 Top N（墨条二） ----------

/** item_companies ⋈ companies 分组计数，count 倒序、id 升序稳定并列，LIMIT ?；JOIN 侧 items 过滤 published=1 */
export function buildCompanyTopSql(limit = 12): SqlStatement {
  return {
    sql:
      "SELECT ic.company_id AS companyId, c.name AS name, COUNT(*) AS count" +
      " FROM item_companies ic" +
      " JOIN companies c ON c.id = ic.company_id" +
      " JOIN items i ON i.id = ic.item_id AND i.published = 1" +
      " GROUP BY ic.company_id" +
      " ORDER BY count DESC, ic.company_id ASC" +
      " LIMIT ?",
    params: [limit],
  };
}

// ---------- 5. enrich 分布（环形三段） ----------

/** enrich_state 分组计数（CHECK 约束限定 ok/missing_owner/pending）；仅 published=1 */
export function buildEnrichDistributionSql(): SqlStatement {
  return {
    sql:
      "SELECT i.enrich_state AS enrichState, COUNT(*) AS count" +
      " FROM items i" +
      " WHERE i.published = 1" +
      " GROUP BY i.enrich_state" +
      " ORDER BY i.enrich_state ASC",
    params: [],
  };
}

// ---------- 6. sync_log 近窗（热力图） ----------

/** sync_log date BETWEEN from AND to 升序取 date/status/error_message；不过滤 published（与发布态无关）。
 *  上界排除未来日期行（本地 2099 演练行等不入近 84 天窗）。 */
export function buildSyncRecentSql(from: string, to: string): SqlStatement {
  return {
    sql:
      "SELECT date, status, error_message AS errorMessage" +
      " FROM sync_log" +
      " WHERE date >= ? AND date <= ?" +
      " ORDER BY date ASC",
    params: [from, to],
  };
}

// ---------- 7. 契约组装 ----------

/** GET /api/stats 契约形状（spec08「契约（钉死）」节，逐字段对齐） */
export interface StatsResponse {
  overview: {
    issues: number;
    items: number;
    companies: number;
    attributed: number;
    attributedRate: number;
    lastSyncAt: string | null;
  };
  daily: DailyPoint[];
  categories: { category: string; count: number }[];
  companies: { id: string; name: string; count: number }[];
  enrich: { ok: number; missing_owner: number; pending: number };
  sync: { date: string; status: string; error: string | null }[];
}

export interface StatsParts {
  overview: OverviewRow;
  itemDaily: DailyCountRow[];
  issueDaily: DailyCountRow[];
  categories: CategoryRow[];
  companyTop: CompanyTopRow[];
  enrich: EnrichRow[];
  sync: SyncRow[];
}

/**
 * 组装契约形状：attributedRate = items>0 ? Math.round(attributed/items*1000)/1000 : 0；
 * enrich 三桶缺省补 0；sync 行 error_message→error（空串→null）；数值一律 Number() 收敛。
 */
export function buildStatsResponse(parts: StatsParts): StatsResponse {
  const items = Number(parts.overview.items);
  const attributed = Number(parts.overview.attributed);
  const enrich: StatsResponse["enrich"] = { ok: 0, missing_owner: 0, pending: 0 };
  for (const r of parts.enrich) {
    if (r.enrichState === "ok") enrich.ok = Number(r.count);
    else if (r.enrichState === "missing_owner") enrich.missing_owner = Number(r.count);
    else if (r.enrichState === "pending") enrich.pending = Number(r.count);
  }
  return {
    overview: {
      issues: Number(parts.overview.issues),
      items,
      companies: Number(parts.overview.companies),
      attributed,
      attributedRate: items > 0 ? Math.round((attributed / items) * 1000) / 1000 : 0,
      lastSyncAt: parts.overview.lastSyncAt ?? null,
    },
    daily: mergeDaily(parts.itemDaily, parts.issueDaily),
    categories: parts.categories.map((r) => ({ category: r.category, count: Number(r.count) })),
    companies: parts.companyTop.map((r) => ({ id: r.companyId, name: r.name, count: Number(r.count) })),
    enrich,
    sync: parts.sync.map((r) => ({
      date: r.date,
      status: r.status,
      error: r.errorMessage === null || r.errorMessage === "" ? null : r.errorMessage,
    })),
  };
}

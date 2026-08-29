// 纯 SQL 构造器（spec04 A3）：输入过滤参数 → 输出 { sql, params }。
// 铁律：用户输入一律走 bind 参数（?），绝不拼进 SQL 字符串——注入安全由 worker/api/queries.test.ts 钉死。
// 不做校验/不做 I/O：参数合法性（日期格式、limit 1..31）由 routes 层负责，这里只组装。
// 消费方式：env.DB.prepare(stmt.sql).bind(...stmt.params)。

export interface SqlStatement {
  sql: string;
  params: unknown[];
}

/** /api/items 分页与过滤参数（均可选；语义见 spec04「API 契约」3 + spec06 契约扩展 1） */
export interface ItemsFilters {
  company?: string; // item_companies EXISTS
  category?: string; // items.category 精确匹配
  from?: string; // 日期闭区间下界
  to?: string; // 日期闭区间上界
  beforeDate?: string; // 不含该日，取更早期
  q?: string; // 全文子串搜索：LIKE '%q%'（title/summary/body_md 三列 OR，通配符按字面）
  limit?: number; // 每页期数，默认 DEFAULT_PAGE_LIMIT
}

export const DEFAULT_PAGE_LIMIT = 7;
// D1 限制单查询最多 100 个绑定参数；留 10 余量供 IN 之外的过滤参数使用。
export const MAX_BOUND_PARAMS = 90;

// ---------- 通用过滤子句（期集合与条目集合两层共用 company/category） ----------

interface WhereClause {
  sql: string;
  params: unknown[];
}

/** company/category 过滤子句（两层过滤共用，参数顺序固定 category → company） */
function companyCategoryClauses(filters: ItemsFilters): WhereClause {
  let sql = "";
  const params: unknown[] = [];
  if (filters.category !== undefined && filters.category !== "") {
    sql += " AND i.category = ?";
    params.push(filters.category);
  }
  if (filters.company !== undefined && filters.company !== "") {
    sql += " AND EXISTS (SELECT 1 FROM item_companies ic WHERE ic.item_id = i.id AND ic.company_id = ?)";
    params.push(filters.company);
  }
  return { sql, params };
}

// ---------- q 搜索子句（spec06 契约扩展 1）----------

// LIKE 通配符 %/_ 与转义符 \ 本身按字面匹配：前缀 \ 转义 + SQL 端 ESCAPE '\'（spec06 转义钉死）。
function escapeLikePattern(q: string): string {
  return q.replace(/[\\%_]/g, "\\$&");
}

/** q 全文子串子句：title/summary/body_md 三列 LIKE '%q%'（OR）；pattern 整段经 bind 参数传入 */
function qClause(filters: ItemsFilters): WhereClause {
  if (filters.q === undefined || filters.q === "") return { sql: "", params: [] };
  const pattern = `%${escapeLikePattern(filters.q)}%`;
  return {
    sql:
      " AND (i.title LIKE ? ESCAPE '\\' OR i.summary LIKE ? ESCAPE '\\' OR i.body_md LIKE ? ESCAPE '\\')",
    params: [pattern, pattern, pattern],
  };
}

// ---------- 1. 期集合（/api/items 第一层） ----------

/** 命中过滤的「期」日期列表：DISTINCT date，新→旧，LIMIT limit（默认 7） */
export function buildItemsDatesQuery(filters: ItemsFilters): SqlStatement {
  let where = "";
  const params: unknown[] = [];
  if (filters.beforeDate !== undefined && filters.beforeDate !== "") {
    where += " AND i.date < ?";
    params.push(filters.beforeDate);
  }
  if (filters.from !== undefined && filters.from !== "") {
    where += " AND i.date >= ?";
    params.push(filters.from);
  }
  if (filters.to !== undefined && filters.to !== "") {
    where += " AND i.date <= ?";
    params.push(filters.to);
  }
  const cc = companyCategoryClauses(filters);
  where += cc.sql;
  params.push(...cc.params);
  const qc = qClause(filters);
  where += qc.sql;
  params.push(...qc.params);

  const limit = filters.limit ?? DEFAULT_PAGE_LIMIT;
  return {
    sql:
      "SELECT DISTINCT i.date" +
      " FROM items i" +
      " WHERE 1=1" +
      where +
      " ORDER BY i.date DESC" +
      " LIMIT ?",
    params: [...params, limit],
  };
}

// ---------- 2. 期内条目（/api/items 第二层） ----------

/** 指定日期集合内的条目（company/category 两层过滤继续生效）；期内按 #N 升序，期之间新→旧 */
export function buildItemsForDatesQuery(dates: string[], filters: ItemsFilters): SqlStatement {
  if (dates.length === 0) throw new Error("buildItemsForDatesQuery: dates 不能为空（调用方应短路）");
  const placeholders = dates.map(() => "?").join(",");
  const cc = companyCategoryClauses(filters);
  const qc = qClause(filters);
  return {
    sql:
      "SELECT i.id, i.date, i.tag, i.sequence_int, i.category, i.title," +
      " i.primary_link, i.summary, i.related_links, i.enrich_state" +
      " FROM items i" +
      ` WHERE i.date IN (${placeholders})` +
      cc.sql +
      qc.sql +
      " ORDER BY i.date DESC, i.sequence_int ASC, i.id ASC",
    params: [...dates, ...cc.params, ...qc.params],
  };
}

// ---------- 3. 条目归属（/api/items 第三层） ----------

/** 条目的公司归属（v1 无 role，ADR-0014）；调用方按 itemId 分组、组内按 company id 排序 */
export function buildOwnersForItemsQuery(itemIds: string[]): SqlStatement {
  if (itemIds.length === 0) throw new Error("buildOwnersForItemsQuery: itemIds 不能为空（调用方应短路）");
  const placeholders = itemIds.map(() => "?").join(",");
  return {
    sql:
      "SELECT ic.item_id AS itemId, ic.company_id AS companyId, c.name, c.color" +
      " FROM item_companies ic" +
      " JOIN companies c ON c.id = ic.company_id" +
      ` WHERE ic.item_id IN (${placeholders})` +
      " ORDER BY ic.company_id ASC",
    params: itemIds,
  };
}

// ---------- 4. 公司索引（/api/companies） ----------

/** 全公司列表 + total/last30d/lastEventDate 统计；total 倒序（同数按 id 稳定序） */
export function buildCompaniesIndexQuery(input: { last30dFrom: string }): SqlStatement {
  return {
    sql:
      "SELECT c.id, c.name, c.color, c.notes, c.aliases, c.status," +
      " (SELECT COUNT(*) FROM item_companies ic WHERE ic.company_id = c.id) AS total," +
      " (SELECT COUNT(*) FROM item_companies ic JOIN items i ON i.id = ic.item_id" +
      "   WHERE ic.company_id = c.id AND i.date >= ?) AS last30d," +
      " (SELECT MAX(i.date) FROM item_companies ic JOIN items i ON i.id = ic.item_id" +
      "   WHERE ic.company_id = c.id) AS lastEventDate" +
      " FROM companies c" +
      " ORDER BY total DESC, c.id ASC",
    params: [input.last30dFrom],
  };
}

// ---------- 5. 公司档案（/api/companies/:id，档案头五块） ----------

export interface CompanyProfileStatements {
  company: SqlStatement;
  stats: SqlStatement;
  categoryDistribution: SqlStatement;
  coworkers: SqlStatement;
}

/**
 * 档案头四条语句（timeSpan 由 stats 的 earliest/latest 提供）：
 * 基础信息 / 统计+时间跨度 / 分类分布 / 关联公司 ≤8 按次数倒序。
 */
export function buildCompanyProfileQueries(
  companyId: string,
  input: { last30dFrom: string }
): CompanyProfileStatements {
  const company: SqlStatement = {
    sql:
      "SELECT id, name, color, notes, aliases, status" +
      " FROM companies WHERE id = ?",
    params: [companyId],
  };

  // 一行出全：total / last30d / lastEventDate / timeSpan(earliest, latest)
  const stats: SqlStatement = {
    sql:
      "SELECT" +
      " (SELECT COUNT(*) FROM item_companies WHERE company_id = ?) AS total," +
      " (SELECT COUNT(*) FROM item_companies ic JOIN items i ON i.id = ic.item_id" +
      "   WHERE ic.company_id = ? AND i.date >= ?) AS last30d," +
      " (SELECT MAX(i.date) FROM item_companies ic JOIN items i ON i.id = ic.item_id" +
      "   WHERE ic.company_id = ?) AS lastEventDate," +
      " (SELECT MIN(i.date) FROM item_companies ic JOIN items i ON i.id = ic.item_id" +
      "   WHERE ic.company_id = ?) AS earliest," +
      " (SELECT MAX(i.date) FROM item_companies ic JOIN items i ON i.id = ic.item_id" +
      "   WHERE ic.company_id = ?) AS latest",
    params: [companyId, companyId, input.last30dFrom, companyId, companyId, companyId],
  };

  const categoryDistribution: SqlStatement = {
    sql:
      "SELECT i.category AS category, COUNT(*) AS count" +
      " FROM item_companies ic" +
      " JOIN items i ON i.id = ic.item_id" +
      " WHERE ic.company_id = ?" +
      " GROUP BY i.category" +
      " ORDER BY count DESC, category ASC",
    params: [companyId],
  };

  // 关联公司 = 与该公司同条目共现的其他公司；≤8 按共现次数倒序（同数按 id 稳定序）
  const coworkers: SqlStatement = {
    sql:
      "SELECT ic2.company_id AS companyId, c2.name AS name, c2.color AS color," +
      " COUNT(*) AS count" +
      " FROM item_companies ic1" +
      " JOIN item_companies ic2 ON ic2.item_id = ic1.item_id AND ic2.company_id <> ic1.company_id" +
      " JOIN companies c2 ON c2.id = ic2.company_id" +
      " WHERE ic1.company_id = ?" +
      " GROUP BY ic2.company_id" +
      " ORDER BY count DESC, companyId ASC" +
      " LIMIT 8",
    params: [companyId],
  };

  return { company, stats, categoryDistribution, coworkers };
}

// ---------- 分块工具（routes 层防 D1 绑定参数上限） ----------

/** 等分切分数组（保序、无空尾块）；用于 itemIds 超过 MAX_BOUND_PARAMS 时分批查询 */
export function chunkArray<T>(items: T[], size: number): T[][] {
  if (size < 1) throw new Error(`chunkArray: size 必须 ≥ 1，实际 ${size}`);
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

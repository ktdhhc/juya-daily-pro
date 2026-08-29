// sqlgen — D1 回填 SQL 生成的纯函数集合（spec02 2.2）。
// 纯函数：无 fetch / fs / process / Cloudflare 专属 API（ADR-0011 只测纯函数）。
// SQL 纪律（spec 2.2 末段）：每条生成的语句以 `;` 收尾；单语句单行——
// 换行只允许出现在字符串字面量内（wrangler 的 SQL 拆分是引号感知的，但保持该纪律降低风险）。
// 幂等（ADR-0008/0013）：INSERT ... ON CONFLICT(<key>) DO UPDATE SET 全部非键列。
import type { Company, Item } from "../../src/lib/schema";

// ---------- 文本转义 ----------

// 单引号翻倍（SQL 字面量转义）；去除 \0（D1/SQLite 不接受 NUL 字节）。
// SQLite 无反斜杠转义，反斜杠原样保留。
export function escapeSqlText(s: string): string {
  return s.replace(/\0/g, "").replace(/'/g, "''");
}

// 字面量包裹（escapeSqlText 之后拼进单引号）
const quote = (s: string): string => `'${escapeSqlText(s)}'`;

// ---------- sources ----------

export function sourcesUpsertSql(date: string, markdown: string): string {
  return (
    `INSERT INTO sources (date, markdown) VALUES (${quote(date)}, ${quote(markdown)}) ` +
    "ON CONFLICT(date) DO UPDATE SET markdown = excluded.markdown;"
  );
}

// ---------- items ----------

// 列清单按 spec 2.2：id, date, tag, sequence_int, category, title, primary_link,
// summary, body_md, related_links, enrich_state（owners 走 item_companies，spec 03）。
// primary_link undefined → NULL；related_links 存 JSON 字符串。
export function itemsUpsertSql(items: Item[]): string {
  if (items.length === 0) return "";
  const rows = items.map((it) => {
    const primaryLink = it.primaryLink === undefined ? "NULL" : quote(it.primaryLink);
    return (
      `(${quote(it.id)}, ${quote(it.date)}, ${quote(it.tag)}, ${it.sequenceInt}, ` +
      `${quote(it.category)}, ${quote(it.title)}, ${primaryLink}, ${quote(it.summary)}, ` +
      `${quote(it.bodyMd)}, ${quote(JSON.stringify(it.relatedLinks))}, ${quote(it.enrichState)})`
    );
  });
  return (
    "INSERT INTO items (id, date, tag, sequence_int, category, title, primary_link, " +
    "summary, body_md, related_links, enrich_state) " +
    `VALUES ${rows.join(", ")} ` +
    "ON CONFLICT(id) DO UPDATE SET date = excluded.date, tag = excluded.tag, " +
    "sequence_int = excluded.sequence_int, category = excluded.category, " +
    "title = excluded.title, primary_link = excluded.primary_link, " +
    "summary = excluded.summary, body_md = excluded.body_md, " +
    "related_links = excluded.related_links, enrich_state = excluded.enrich_state;"
  );
}

// ---------- companies ----------

// 列清单按 spec 2.2：id, name, aliases(JSON), color, status, notes。
export function companiesUpsertSql(companies: Company[]): string {
  if (companies.length === 0) return "";
  const rows = companies.map(
    (c) =>
      `(${quote(c.id)}, ${quote(c.name)}, ${quote(JSON.stringify(c.aliases))}, ` +
      `${quote(c.color)}, ${quote(c.status)}, ${quote(c.notes)})`,
  );
  return (
    "INSERT INTO companies (id, name, aliases, color, status, notes) " +
    `VALUES ${rows.join(", ")} ` +
    "ON CONFLICT(id) DO UPDATE SET name = excluded.name, aliases = excluded.aliases, " +
    "color = excluded.color, status = excluded.status, notes = excluded.notes;"
  );
}

// ---------- registry prune（spec06 契约扩展 3，ADR-0001 镜像删除语义补全）----------

// registry 镜像删除：清掉不在 activeIds（当前 yaml registry id 集合）内的镜像行。
// companies 先删（FK ON DELETE CASCADE 连带 item_companies），item_companies 按 company_id 再兜底删；
// 两条 DELETE 均单语句单行（换行仅作语句分隔）；空数组 → 空串（无 registry 不清任何行）。
export function companiesPruneSql(activeIds: string[]): string {
  if (activeIds.length === 0) return "";
  const ids = activeIds.map(quote).join(", ");
  return (
    `DELETE FROM companies WHERE id NOT IN (${ids});\n` +
    `DELETE FROM item_companies WHERE company_id NOT IN (${ids});`
  );
}

// ---------- item_companies / enrich_state（spec03）----------

// 段一匹配结果写入：role 恒 NULL（ADR-0014 v1 单段）；冲突时以新 role 覆盖
// （当前恒 NULL，未来 LLM enrich 回填复用同一语句）。
export function itemCompaniesUpsertSql(rows: { itemId: string; companyId: string }[]): string {
  if (rows.length === 0) return "";
  const values = rows.map((r) => `(${quote(r.itemId)}, ${quote(r.companyId)}, NULL)`);
  return (
    "INSERT INTO item_companies (item_id, company_id, role) " +
    `VALUES ${values.join(", ")} ` +
    "ON CONFLICT(item_id, company_id) DO UPDATE SET role = excluded.role;"
  );
}

// enrich_state 回写：ok / missing_owner 两档各一条 UPDATE ... IN（字面量）；
// 空列表跳过对应语句（无 id 可更新时不出空 IN）。多语句按 SQL 纪律单语句单行。
export function enrichStateUpdateSql(okIds: string[], missingIds: string[]): string {
  const statements: string[] = [];
  if (okIds.length > 0) {
    statements.push(`UPDATE items SET enrich_state = 'ok' WHERE id IN (${okIds.map(quote).join(", ")});`);
  }
  if (missingIds.length > 0) {
    statements.push(
      `UPDATE items SET enrich_state = 'missing_owner' WHERE id IN (${missingIds.map(quote).join(", ")});`,
    );
  }
  return statements.join("\n");
}

// ---------- sync_log（spec05 Step 1.2，ADR-0008）----------

// 单期同步结果 UPSERT：date 为 PK，重跑覆盖（attempted_at/status/error_message 全非键列更新）。
// attempted_at 用 datetime('now')（插入与冲突更新都取执行时刻）；errorMessage 空串（ok 档）→ 裸 NULL，
// 非空 → 字面量（转义规则同 escapeSqlText）。
export function syncLogUpsertSql(date: string, status: string, errorMessage: string): string {
  const err = errorMessage === "" ? "NULL" : quote(errorMessage);
  return (
    "INSERT INTO sync_log (date, attempted_at, status, error_message) " +
    `VALUES (${quote(date)}, datetime('now'), ${quote(status)}, ${err}) ` +
    "ON CONFLICT(date) DO UPDATE SET attempted_at = excluded.attempted_at, " +
    "status = excluded.status, error_message = excluded.error_message;"
  );
}

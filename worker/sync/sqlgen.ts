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

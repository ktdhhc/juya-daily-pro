// sqlgen TDD 测试（spec02 2.2）
// 覆盖：转义 round-trip、NULL primary_link、JSON 序列化形态、ON CONFLICT 子句、空输入、
// SQL 纪律（每条语句 `;` 收尾；单语句单行——换行只允许出现在字符串字面量内）。
import { describe, expect, it } from "vitest";
import type { Company, Item } from "../../src/lib/schema";
import {
  companiesUpsertSql,
  enrichStateUpdateSql,
  escapeSqlText,
  itemCompaniesUpsertSql,
  itemsUpsertSql,
  sourcesUpsertSql,
  syncLogUpsertSql,
} from "./sqlgen";

// ---------- 测试辅助 ----------

// 模拟 SQL 单引号字面量的反转义（引号翻倍的逆操作），用于 round-trip 验证
const unescapeSqlText = (s: string): string => s.replace(/''/g, "'");

// 把字符串字面量折叠成 ''（SQL 感知引号配对，'' 是转义引号），以便检查字面量外的语句体
const stripLiterals = (sql: string): string => sql.replace(/'(?:[^']|'')*'/g, "''");

// SQL 纪律：`;` 收尾且仅结尾一个；字面量之外不含换行（单语句单行）
const expectDiscipline = (sql: string): void => {
  expect(sql.endsWith(";")).toBe(true);
  const body = sql.slice(0, -1);
  expect(body.includes(";")).toBe(false); // 单条语句
  expect(stripLiterals(body)).not.toMatch(/[\r\n]/); // 换行只许在字面量内
};

// Item 构造器：缺省填合法值，便于按需覆盖
const itemOf = (over: Partial<Item>): Item => ({
  id: "20260827-1",
  date: "2026-08-27",
  tag: "#1",
  sequenceInt: 1,
  category: "要闻",
  title: "智谱正式发布并开源 GLM-5.3-Flash",
  summary: "概览摘要",
  bodyMd: "正文",
  relatedLinks: ["https://example.com/a"],
  owners: [],
  enrichState: "ok",
  ...over,
});

const companyOf = (over: Partial<Company>): Company => ({
  id: "zhipu",
  name: "智谱",
  aliases: ["Zhipu AI", "/GLM-?\\d/"],
  color: "#2563eb",
  status: "active",
  notes: "一句话定位",
  ...over,
});

// ---------- escapeSqlText ----------

describe("escapeSqlText", () => {
  it("单引号翻倍", () => {
    expect(escapeSqlText("O'Brien")).toBe("O''Brien");
    expect(escapeSqlText("'''")).toBe("''''''");
  });

  it("去除 \\0", () => {
    expect(escapeSqlText("a\0b")).toBe("ab");
    expect(escapeSqlText("\0")).toBe("");
  });

  it("无特殊字符原样返回", () => {
    expect(escapeSqlText("智谱 GLM-5.3-Flash #1 [2026-08-27]")).toBe(
      "智谱 GLM-5.3-Flash #1 [2026-08-27]",
    );
  });

  it("round-trip：引号翻倍可逆（\\0 按设计移除，不参与）", () => {
    const samples = [
      "O'Brien",
      "含'单'引号\n换行\r\n混合",
      "反斜杠\\不改写",
      "''",
      "",
      "中文'引号'与 emoji 🎉",
    ];
    for (const s of samples) {
      expect(unescapeSqlText(escapeSqlText(s))).toBe(s);
    }
  });
});

// ---------- sourcesUpsertSql ----------

describe("sourcesUpsertSql", () => {
  it("形态：INSERT INTO sources + ON CONFLICT(date) DO UPDATE SET markdown，; 收尾单语句", () => {
    const sql = sourcesUpsertSql("2026-08-27", "# AI 早报 2026-08-27");
    expect(sql).toMatch(/^INSERT INTO sources \(date, markdown\) VALUES /);
    expect(sql).toContain("ON CONFLICT(date) DO UPDATE SET markdown = excluded.markdown;");
    expectDiscipline(sql);
  });

  it("markdown 含换行/单引号 → 进入字面量并被转义，可 round-trip", () => {
    const md = "# AI 早报\n\n> 概览'引\n\n- [x](https://a)";
    const sql = sourcesUpsertSql("2026-08-27", md);
    expect(sql).toContain("# AI 早报\n\n> 概览''引");
    // 从生成的 VALUES 中还原 markdown（取第一个字面量之外……直接按两个参数切）
    // [\s\S] 而非 .+s 标志：tsconfig target ES2017 不支持 dotAll flag（TS1501）
    const m = /^INSERT INTO sources \(date, markdown\) VALUES \('([\s\S]*)'\)\s+ON CONFLICT/.exec(
      sql,
    );
    expect(m).not.toBeNull();
    const markdown = (m![1] as string)
      .replace(/^2026-08-27'\s*,\s*'/, "")
      .replace(/''/g, "'");
    expect(markdown).toBe(md);
  });
});

// ---------- itemsUpsertSql ----------

describe("itemsUpsertSql", () => {
  it("列齐全 + related_links JSON 形态 + sequence_int 裸数字 + ON CONFLICT(id) 全非键列", () => {
    const sql = itemsUpsertSql([itemOf({})]);
    expect(sql).toContain(
      "INSERT INTO items (id, date, tag, sequence_int, category, title, primary_link, summary, body_md, related_links, enrich_state) VALUES ",
    );
    // related_links 存 JSON 字符串
    expect(sql).toContain(`'["https://example.com/a"]'`);
    // sequence_int 为裸数字（非引号包裹）
    expect(sql).toContain(", 1, '");
    expect(sql).toMatch(
      /ON CONFLICT\(id\) DO UPDATE SET date = excluded\.date, tag = excluded\.tag, sequence_int = excluded\.sequence_int, category = excluded\.category, title = excluded\.title, primary_link = excluded\.primary_link, summary = excluded\.summary, body_md = excluded\.body_md, related_links = excluded\.related_links, enrich_state = excluded\.enrich_state;$/,
    );
    expectDiscipline(sql);
  });

  it("primaryLink 缺省 → NULL（裸 NULL，非 'NULL' 字符串）", () => {
    const item = itemOf({ primaryLink: undefined });
    const sql = itemsUpsertSql([item]);
    expect(sql).toContain(", NULL, '概览摘要',");
    expect(sql).not.toContain("'NULL'");
  });

  it("primaryLink 有值 → 带引号字面量", () => {
    const sql = itemsUpsertSql([itemOf({ primaryLink: "https://example.com/x" })]);
    expect(sql).toContain("'https://example.com/x'");
    expect(sql).not.toContain("NULL");
  });

  it("title/summary 含单引号与换行 → 转义且字面量内换行合法，纪律仍成立", () => {
    const sql = itemsUpsertSql([
      itemOf({ title: "It's fine", bodyMd: "第一段\n\n第二段's 引" }),
    ]);
    expect(sql).toContain("'It''s fine'");
    expect(sql).toContain("第一段\n\n第二段''s 引");
    expectDiscipline(sql);
  });

  it("多条 → VALUES 逗号连接为单语句", () => {
    const sql = itemsUpsertSql([itemOf({ id: "20260827-1" }), itemOf({ id: "20260827-2" })]);
    expect(sql).toContain("'ok'), ('20260827-2'"); // 行间分隔 "), ("，次行以 id 开头
    expectDiscipline(sql);
  });

  it("空数组 → 空串", () => {
    expect(itemsUpsertSql([])).toBe("");
  });
});

// ---------- companiesUpsertSql ----------

describe("companiesUpsertSql", () => {
  it("aliases JSON 序列化 + ON CONFLICT(id) DO UPDATE 全非键列", () => {
    const sql = companiesUpsertSql([companyOf({})]);
    expect(sql).toContain(
      "INSERT INTO companies (id, name, aliases, color, status, notes) VALUES ",
    );
    // 字面量与正则混合的 aliases 以 JSON 存储（正则的反斜杠原样保留）
    expect(sql).toContain(`'["Zhipu AI","/GLM-?\\\\d/"]'`);
    expect(sql).toMatch(
      /ON CONFLICT\(id\) DO UPDATE SET name = excluded\.name, aliases = excluded\.aliases, color = excluded\.color, status = excluded\.status, notes = excluded\.notes;$/,
    );
    expectDiscipline(sql);
  });

  it("status 枚举与含引号 name 正常转义", () => {
    const sql = companiesUpsertSql([companyOf({ name: "L'Oréal AI", status: "dormant" })]);
    expect(sql).toContain("'L''Oréal AI'");
    expect(sql).toContain("'dormant'");
    expectDiscipline(sql);
  });

  it("空数组 → 空串", () => {
    expect(companiesUpsertSql([])).toBe("");
  });
});

// ---------- itemCompaniesUpsertSql（spec03 Step 2）----------

describe("itemCompaniesUpsertSql", () => {
  it("role 恒 NULL（裸 NULL）+ ON CONFLICT(item_id, company_id) DO UPDATE SET role，; 收尾单语句", () => {
    const sql = itemCompaniesUpsertSql([{ itemId: "20260827-1", companyId: "anthropic" }]);
    expect(sql).toBe(
      "INSERT INTO item_companies (item_id, company_id, role) " +
        "VALUES ('20260827-1', 'anthropic', NULL) " +
        "ON CONFLICT(item_id, company_id) DO UPDATE SET role = excluded.role;",
    );
    expect(sql).not.toContain("'NULL'"); // role 是裸 NULL，非字符串
    expectDiscipline(sql);
  });

  it("多行 → VALUES 逗号连接为单语句", () => {
    const sql = itemCompaniesUpsertSql([
      { itemId: "20260827-1", companyId: "anthropic" },
      { itemId: "20260827-1", companyId: "openai" },
      { itemId: "20260828-2", companyId: "anthropic" },
    ]);
    expect(sql).toContain(
      "VALUES ('20260827-1', 'anthropic', NULL), ('20260827-1', 'openai', NULL), " +
        "('20260828-2', 'anthropic', NULL) ",
    );
    expectDiscipline(sql);
  });

  it("itemId/companyId 单引号翻倍转义", () => {
    const sql = itemCompaniesUpsertSql([{ itemId: "it'1", companyId: "L'Oréal" }]);
    expect(sql).toContain("'it''1', 'L''Oréal', NULL)");
    expectDiscipline(sql);
  });

  it("空数组 → 空串", () => {
    expect(itemCompaniesUpsertSql([])).toBe("");
  });
});

// ---------- enrichStateUpdateSql（spec03 Step 2）----------

describe("enrichStateUpdateSql", () => {
  it("两列表 → 两条 UPDATE（ok 先、missing_owner 后），单语句单行、各 ; 收尾", () => {
    const sql = enrichStateUpdateSql(["a", "b"], ["c"]);
    const lines = sql.split("\n");
    expect(lines).toEqual([
      "UPDATE items SET enrich_state = 'ok' WHERE id IN ('a', 'b');",
      "UPDATE items SET enrich_state = 'missing_owner' WHERE id IN ('c');",
    ]);
    for (const line of lines) expectDiscipline(line);
  });

  it("空列表跳过对应语句：仅 missing → 单条 missing_owner", () => {
    const sql = enrichStateUpdateSql([], ["m1"]);
    expect(sql).toBe("UPDATE items SET enrich_state = 'missing_owner' WHERE id IN ('m1');");
    expectDiscipline(sql);
  });

  it("空列表跳过对应语句：仅 ok → 单条 ok", () => {
    const sql = enrichStateUpdateSql(["o1"], []);
    expect(sql).toBe("UPDATE items SET enrich_state = 'ok' WHERE id IN ('o1');");
    expectDiscipline(sql);
  });

  it("双空 → 空串", () => {
    expect(enrichStateUpdateSql([], [])).toBe("");
  });

  it("id 含单引号 → 字面量转义", () => {
    const sql = enrichStateUpdateSql(["it's"], []);
    expect(sql).toContain("'it''s'");
    expectDiscipline(sql);
  });
});

// ---------- syncLogUpsertSql（spec05 Step 1.2）----------

describe("syncLogUpsertSql", () => {
  it("ok：attempted_at=datetime('now')、error_message 裸 NULL、ON CONFLICT(date) 全非键列更新、; 收尾单语句", () => {
    const sql = syncLogUpsertSql("2026-08-28", "ok", "");
    expect(sql).toBe(
      "INSERT INTO sync_log (date, attempted_at, status, error_message) " +
        "VALUES ('2026-08-28', datetime('now'), 'ok', NULL) " +
        "ON CONFLICT(date) DO UPDATE SET attempted_at = excluded.attempted_at, " +
        "status = excluded.status, error_message = excluded.error_message;",
    );
    expect(sql).not.toContain("'NULL'"); // error_message 是裸 NULL，非字符串
    expect(sql).toContain("datetime('now')");
    expectDiscipline(sql);
  });

  it("fetch_failed：错误消息进 error_message 字面量（404 演练形态）", () => {
    const sql = syncLogUpsertSql("2099-01-01", "fetch_failed", "HTTP 404 https://daily.juya.uk/markdown/2099-01-01.md");
    expect(sql).toContain(
      "'2099-01-01', datetime('now'), 'fetch_failed', " +
        "'HTTP 404 https://daily.juya.uk/markdown/2099-01-01.md'",
    );
    expectDiscipline(sql);
  });

  it("error_message 含单引号与换行 → 引号翻倍、换行只进字面量，纪律成立", () => {
    const sql = syncLogUpsertSql("2026-08-27", "parse_failed", "issue date not found: 'x'\n第二行");
    expect(sql).toContain("'issue date not found: ''x''\n第二行'");
    expectDiscipline(sql);
  });
});

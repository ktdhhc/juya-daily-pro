// stats.ts 纯函数单测（spec08 Step 2.1，TDD 先行）。
// 覆盖：构造器 SQL 关键子句与参数绑定、published=1 过滤（spec10 暂存语义：staged 条目不计入聚合）、
// mergeDaily 稀疏合并与升序、buildStatsResponse 数值收敛/三位小数/0 除/enrich 缺桶补 0/sync error null 化。
// sync_log 不过滤（同步日志与发布态无关）。
import { describe, expect, it } from "vitest";
import type { SqlStatement } from "./queries";
import {
  buildCategoryAggregateSql,
  buildCompanyTopSql,
  buildDailyIssuesSql,
  buildDailyItemsSql,
  buildEnrichDistributionSql,
  buildOverviewCountsSql,
  buildStatsResponse,
  buildSyncRecentSql,
  mergeDaily,
  type DailyCountRow,
  type StatsParts,
} from "./stats";

const countPlaceholders = (sql: string): number => (sql.match(/\?/g) ?? []).length;

// 不变量：占位符数 === 参数数（bind 不会错位），与 queries.test.ts 同款
function expectConsistent(stmt: SqlStatement): void {
  expect(countPlaceholders(stmt.sql)).toBe(stmt.params.length);
}

const EVIL = "'; DROP TABLE items; --";

// ---------- 构造器：SQL 关键子句与参数绑定 ----------

describe("buildOverviewCountsSql（总览单行五值）", () => {
  it("五个标量子查询：issues/items/companies/attributed/lastSyncAt，无绑定参数", () => {
    const q = buildOverviewCountsSql();
    expect(q.sql).toContain("FROM sources WHERE published = 1) AS issues");
    expect(q.sql).toContain("FROM items WHERE published = 1) AS items");
    expect(q.sql).toContain("FROM companies) AS companies");
    expect(q.sql).toContain("enrich_state = 'ok') AS attributed");
    expect(q.sql).toContain("FROM sync_log WHERE status = 'ok') AS lastSyncAt");
    expect(q.sql).toContain("MAX(attempted_at)");
    expect(q.params).toEqual([]);
    expect(countPlaceholders(q.sql)).toBe(0);
    expectConsistent(q);
  });

  it("published 过滤恰三处：issues（sources）1 + items/attributed（items）2", () => {
    expect(buildOverviewCountsSql().sql.match(/published = 1/g)?.length).toBe(3);
  });
});

describe("buildDailyItemsSql / buildDailyIssuesSql（按日计数）", () => {
  it("items：date >= ? 绑定参数 + published=1 + 按日分组升序", () => {
    const q = buildDailyItemsSql("2026-06-01");
    expect(q.sql).toContain("FROM items i");
    expect(q.sql).toContain("i.date >= ?");
    expect(q.sql).toContain("i.published = 1");
    expect(q.sql).toContain("GROUP BY i.date");
    expect(q.sql).toContain("ORDER BY i.date ASC");
    expect(q.params).toEqual(["2026-06-01"]);
    expectConsistent(q);
  });

  it("issues：sources 按日计数，同样 date >= ? 升序", () => {
    const q = buildDailyIssuesSql("2026-06-01");
    expect(q.sql).toContain("FROM sources s");
    expect(q.sql).toContain("s.date >= ?");
    expect(q.sql).toContain("s.published = 1");
    expect(q.sql).toContain("GROUP BY s.date");
    expect(q.sql).toContain("ORDER BY s.date ASC");
    expect(q.params).toEqual(["2026-06-01"]);
    expectConsistent(q);
  });

  it("注入安全：恶意 from 只进 params，绝不拼进 SQL", () => {
    const q = buildDailyItemsSql(EVIL);
    expect(q.sql).not.toContain("DROP TABLE");
    expect(q.params).toEqual([EVIL]);
    expectConsistent(q);
  });
});

describe("buildCategoryAggregateSql（分类分布）", () => {
  it("category 非空分组计数，count 倒序 + category 稳定序，无绑定参数", () => {
    const q = buildCategoryAggregateSql();
    expect(q.sql).toContain("i.category != ''");
    expect(q.sql).toContain("GROUP BY i.category");
    expect(q.sql).toContain("ORDER BY count DESC, category ASC");
    expect(q.sql).toContain("i.published = 1");
    expect(q.params).toEqual([]);
    expectConsistent(q);
  });
});

describe("buildCompanyTopSql（公司 Top N）", () => {
  it("默认 limit=12：item_companies ⋈ companies，count 倒序、id 稳定并列", () => {
    const q = buildCompanyTopSql();
    expect(q.sql).toContain("FROM item_companies ic");
    expect(q.sql).toContain("JOIN companies c ON c.id = ic.company_id");
    expect(q.sql).toContain("JOIN items i ON i.id = ic.item_id AND i.published = 1");
    expect(q.sql).toContain("GROUP BY ic.company_id");
    expect(q.sql).toContain("ORDER BY count DESC, ic.company_id ASC");
    expect(q.sql).toContain("LIMIT ?");
    expect(q.params).toEqual([12]);
    expectConsistent(q);
  });

  it("显式 limit 覆盖默认 12", () => {
    expect(buildCompanyTopSql(5).params).toEqual([5]);
  });
});

describe("buildEnrichDistributionSql（enrich 分布）", () => {
  it("enrich_state 分组计数 + published=1，无绑定参数", () => {
    const q = buildEnrichDistributionSql();
    expect(q.sql).toContain("GROUP BY i.enrich_state");
    expect(q.sql).toContain("i.published = 1");
    expect(q.params).toEqual([]);
    expectConsistent(q);
  });
});

describe("buildSyncRecentSql（sync_log 近窗）", () => {
  it("date >= ? AND date <= ? 升序取 date/status/error_message，不过滤 published（sync_log 与发布态无关）", () => {
    const q = buildSyncRecentSql("2026-06-07", "2026-08-29");
    expect(q.sql).toContain("FROM sync_log");
    expect(q.sql).toContain("date >= ?");
    expect(q.sql).toContain("date <= ?");
    expect(q.sql).toContain("error_message AS errorMessage");
    expect(q.sql).toContain("ORDER BY date ASC");
    expect(q.sql).not.toContain("published");
    expect(q.params).toEqual(["2026-06-07", "2026-08-29"]);
    expectConsistent(q);
  });

  it("上界排除未来演练行（2099 等异常日期不入近 84 天窗）", () => {
    const q = buildSyncRecentSql("2026-06-07", "2026-08-29");
    expect(q.sql).toContain("date <= ?");
  });

  it("注入安全：恶意 from 只进 params", () => {
    const q = buildSyncRecentSql(EVIL, "2026-08-29");
    expect(q.sql).not.toContain("DROP TABLE");
    expect(q.params).toEqual([EVIL, "2026-08-29"]);
  });
});

// ---------- mergeDaily：两源稀疏合并 ----------

describe("mergeDaily（两源稀疏合并）", () => {
  it("并集日期：缺侧补 0，两源皆无的日期不出现", () => {
    const itemRows: DailyCountRow[] = [{ date: "2026-08-01", count: 3 }];
    const issueRows: DailyCountRow[] = [{ date: "2026-08-02", count: 1 }];
    expect(mergeDaily(itemRows, issueRows)).toEqual([
      { date: "2026-08-01", items: 3, issues: 0 },
      { date: "2026-08-02", items: 0, issues: 1 },
    ]);
  });

  it("同日两源合并 + 输入乱序仍日期升序", () => {
    const itemRows: DailyCountRow[] = [
      { date: "2026-08-03", count: 5 },
      { date: "2026-08-01", count: 3 },
    ];
    const issueRows: DailyCountRow[] = [
      { date: "2026-08-02", count: 1 },
      { date: "2026-08-01", count: 2 },
    ];
    expect(mergeDaily(itemRows, issueRows)).toEqual([
      { date: "2026-08-01", items: 3, issues: 2 },
      { date: "2026-08-02", items: 0, issues: 1 },
      { date: "2026-08-03", items: 5, issues: 0 },
    ]);
  });

  it("D1 字符串计数收敛为 number", () => {
    expect(mergeDaily([{ date: "2026-08-01", count: "4" }], [{ date: "2026-08-01", count: "2" }])).toEqual([
      { date: "2026-08-01", items: 4, issues: 2 },
    ]);
  });

  it("两源皆空 → 空数组", () => {
    expect(mergeDaily([], [])).toEqual([]);
  });
});

// ---------- buildStatsResponse：契约组装 ----------

const baseParts: StatsParts = {
  overview: {
    issues: "73",
    items: "1116",
    companies: "39",
    attributed: "988",
    lastSyncAt: "2026-08-29 03:20:00",
  },
  itemDaily: [
    { date: "2026-08-29", count: "22" },
    { date: "2026-08-28", count: "18" },
  ],
  issueDaily: [{ date: "2026-08-29", count: "1" }],
  categories: [{ category: "要闻", count: "39" }],
  companyTop: [{ companyId: "openai", name: "OpenAI", count: "266" }],
  enrich: [
    { enrichState: "ok", count: "988" },
    { enrichState: "missing_owner", count: "128" },
  ],
  sync: [{ date: "2026-08-28", status: "ok", errorMessage: "" }],
};

describe("buildStatsResponse（契约组装）", () => {
  it("全量组装：契约形状逐字段对齐（spec08 钉死节样例），字符串计数一律 Number 收敛", () => {
    expect(buildStatsResponse(baseParts)).toEqual({
      overview: {
        issues: 73,
        items: 1116,
        companies: 39,
        attributed: 988,
        attributedRate: 0.885,
        lastSyncAt: "2026-08-29 03:20:00",
      },
      daily: [
        { date: "2026-08-28", items: 18, issues: 0 },
        { date: "2026-08-29", items: 22, issues: 1 },
      ],
      categories: [{ category: "要闻", count: 39 }],
      companies: [{ id: "openai", name: "OpenAI", count: 266 }],
      enrich: { ok: 988, missing_owner: 128, pending: 0 },
      sync: [{ date: "2026-08-28", status: "ok", error: null }],
    });
  });

  it("attributedRate 三位小数：Math.round(attributed/items*1000)/1000", () => {
    const r1 = buildStatsResponse({ ...baseParts, overview: { ...baseParts.overview, items: 3, attributed: 1 } });
    expect(r1.overview.attributedRate).toBe(0.333);
    const r2 = buildStatsResponse({ ...baseParts, overview: { ...baseParts.overview, items: 3, attributed: 2 } });
    expect(r2.overview.attributedRate).toBe(0.667);
  });

  it("items=0 → attributedRate=0（0 除防护）", () => {
    const r = buildStatsResponse({ ...baseParts, overview: { ...baseParts.overview, items: 0, attributed: 0 } });
    expect(r.overview.attributedRate).toBe(0);
  });

  it("enrich 缺桶补 0；三桶之外的状态忽略（键恒为三）", () => {
    const r1 = buildStatsResponse({ ...baseParts, enrich: [{ enrichState: "ok", count: 9 }] });
    expect(r1.enrich).toEqual({ ok: 9, missing_owner: 0, pending: 0 });
    const r2 = buildStatsResponse({
      ...baseParts,
      enrich: [...baseParts.enrich, { enrichState: "weird", count: 1 }],
    });
    expect(r2.enrich).toEqual({ ok: 988, missing_owner: 128, pending: 0 });
  });

  it("sync 行 error_message→error：空串与 null 一律 null，非空透传", () => {
    const r = buildStatsResponse({
      ...baseParts,
      sync: [
        { date: "2026-08-28", status: "ok", errorMessage: "" },
        { date: "2026-08-27", status: "fetch_failed", errorMessage: null },
        { date: "2026-08-26", status: "parse_failed", errorMessage: "HTTP 404" },
      ],
    });
    expect(r.sync).toEqual([
      { date: "2026-08-28", status: "ok", error: null },
      { date: "2026-08-27", status: "fetch_failed", error: null },
      { date: "2026-08-26", status: "parse_failed", error: "HTTP 404" },
    ]);
  });

  it("lastSyncAt：null 透传为 null", () => {
    const r = buildStatsResponse({ ...baseParts, overview: { ...baseParts.overview, lastSyncAt: null } });
    expect(r.overview.lastSyncAt).toBeNull();
  });
});

// queries.ts 纯 SQL 构造器单测（spec04 A3，TDD 先行）。
// 覆盖：过滤组合（company/category/from/to/before_date/limit）、默认值、边界、
// 注入安全（用户输入只出现在 params、绝不拼进 sql 字符串）、占位符数 === 参数数不变量。
import { describe, expect, it } from "vitest";
import {
  MAX_BOUND_PARAMS,
  buildCompaniesIndexQuery,
  buildCompanyProfileQueries,
  buildItemsDatesQuery,
  buildItemsForDatesQuery,
  buildOwnersForItemsQuery,
  chunkArray,
  type ItemsFilters,
  type SqlStatement,
} from "./queries";

const countPlaceholders = (sql: string): number => (sql.match(/\?/g) ?? []).length;

// 不变量：所有构造器产物占位符数 === 参数数（bind 不会错位）
function expectConsistent(stmt: SqlStatement): void {
  expect(countPlaceholders(stmt.sql)).toBe(stmt.params.length);
}

const EVIL = "'; DROP TABLE items; --";

describe("buildItemsDatesQuery（期集合）", () => {
  it("无过滤：DISTINCT date + 默认 limit=7，无 before/from/to/category/company 子句", () => {
    const q = buildItemsDatesQuery({});
    expect(q.sql).toContain("SELECT DISTINCT i.date");
    expect(q.sql).toContain("FROM items i");
    expect(q.sql).toContain("ORDER BY i.date DESC");
    expect(q.sql).toContain("LIMIT ?");
    expect(q.sql).not.toContain("< ?");
    expect(q.sql).not.toContain("EXISTS");
    expect(q.sql).not.toContain("category");
    expect(q.params).toEqual([7]);
    expectConsistent(q);
  });

  it("beforeDate：date < ?（不含当日），参数位于 limit 之前", () => {
    const q = buildItemsDatesQuery({ beforeDate: "2026-08-01" });
    expect(q.sql).toContain("i.date < ?");
    expect(q.params).toEqual(["2026-08-01", 7]);
  });

  it("from/to：闭区间 >= ? AND <= ?", () => {
    const q = buildItemsDatesQuery({ from: "2026-07-01", to: "2026-07-31" });
    expect(q.sql).toContain("i.date >= ?");
    expect(q.sql).toContain("i.date <= ?");
    expect(q.params).toEqual(["2026-07-01", "2026-07-31", 7]);
  });

  it("category：i.category = ?", () => {
    const q = buildItemsDatesQuery({ category: "要闻" });
    expect(q.sql).toContain("i.category = ?");
    expect(q.params).toEqual(["要闻", 7]);
  });

  it("company：item_companies EXISTS 子查询", () => {
    const q = buildItemsDatesQuery({ company: "anthropic" });
    expect(q.sql).toContain("EXISTS");
    expect(q.sql).toContain("ic.company_id = ?");
    expect(q.params).toEqual(["anthropic", 7]);
  });

  it("全组合：参数顺序 = beforeDate, from, to, category, company, limit", () => {
    const f: ItemsFilters = {
      company: "openai",
      category: "模型发布",
      from: "2026-06-01",
      to: "2026-08-27",
      beforeDate: "2026-08-28",
      limit: 3,
    };
    const q = buildItemsDatesQuery(f);
    expect(q.params).toEqual(["2026-08-28", "2026-06-01", "2026-08-27", "模型发布", "openai", 3]);
    expectConsistent(q);
  });

  it("limit 边界：1 与 31 原样传入，undefined 才取默认 7", () => {
    expect(buildItemsDatesQuery({ limit: 1 }).params).toEqual([1]);
    expect(buildItemsDatesQuery({ limit: 31 }).params).toEqual([31]);
  });
});

describe("buildItemsForDatesQuery（期内条目）", () => {
  const dates = ["2026-08-27", "2026-08-26", "2026-08-25"];

  it("三日期 → IN 三个占位符，参数即日期本身", () => {
    const q = buildItemsForDatesQuery(dates, {});
    expect(q.sql).toContain("IN (?,?,?)");
    expect(q.params).toEqual(dates);
    expect(q.sql).toContain("ORDER BY i.date DESC, i.sequence_int ASC, i.id ASC");
    expect(q.sql).toContain("enrich_state");
    expectConsistent(q);
  });

  it("category/company 附加在日期参数之后", () => {
    const q = buildItemsForDatesQuery(dates, { category: "要闻", company: "openai" });
    expect(q.sql).toContain("i.category = ?");
    expect(q.sql).toContain("EXISTS");
    expect(q.params).toEqual([...dates, "要闻", "openai"]);
    expectConsistent(q);
  });

  it("空日期数组：抛错（调用方应先短路）", () => {
    expect(() => buildItemsForDatesQuery([], {})).toThrow();
  });

  it("注入安全：恶意输入只进 params", () => {
    const q = buildItemsForDatesQuery(["2026-08-27"], { company: EVIL });
    expect(q.sql).not.toContain("DROP TABLE");
    expect(q.params).toContain(EVIL);
  });
});

describe("buildOwnersForItemsQuery（条目归属）", () => {
  it("两个 id → IN 两个占位符 + JOIN companies 取 name/color", () => {
    const q = buildOwnersForItemsQuery(["20260827-3", "20260827-1"]);
    expect(q.sql).toContain("IN (?,?)");
    expect(q.sql).toContain("JOIN companies c");
    expect(q.params).toEqual(["20260827-3", "20260827-1"]);
    expectConsistent(q);
  });

  it("空数组：抛错", () => {
    expect(() => buildOwnersForItemsQuery([])).toThrow();
  });

  it("注入安全：恶意 item id 只进 params", () => {
    const q = buildOwnersForItemsQuery([EVIL]);
    expect(q.sql).not.toContain("DROP TABLE");
    expect(q.params).toEqual([EVIL]);
  });
});

describe("buildCompaniesIndexQuery（公司索引统计）", () => {
  it("total/last30d/lastEventDate 三个标量子查询 + 按 total 倒序；last30dFrom 走参数", () => {
    const q = buildCompaniesIndexQuery({ last30dFrom: "2026-07-29" });
    expect(q.sql).toContain("AS total");
    expect(q.sql).toContain("AS last30d");
    expect(q.sql).toContain("AS lastEventDate");
    expect(q.sql).toContain("i.date >= ?");
    expect(q.sql).toContain("ORDER BY total DESC, c.id ASC");
    expect(q.params).toEqual(["2026-07-29"]);
    expectConsistent(q);
  });

  it("注入安全：恶意 last30dFrom 只进 params", () => {
    const q = buildCompaniesIndexQuery({ last30dFrom: EVIL });
    expect(q.sql).not.toContain("DROP TABLE");
    expect(q.params).toEqual([EVIL]);
  });
});

describe("buildCompanyProfileQueries（公司档案头）", () => {
  const q = buildCompanyProfileQueries("anthropic", { last30dFrom: "2026-07-29" });

  it("返回四条语句：company / stats / categoryDistribution / coworkers", () => {
    expect(Object.keys(q).sort()).toEqual([
      "categoryDistribution",
      "company",
      "coworkers",
      "stats",
    ]);
    for (const stmt of Object.values(q)) expectConsistent(stmt);
  });

  it("company：按 id 精确查一行", () => {
    expect(q.company.sql).toContain("FROM companies");
    expect(q.company.sql).toContain("WHERE id = ?");
    expect(q.company.params).toEqual(["anthropic"]);
  });

  it("stats：total/last30d/lastEventDate/earliest/latest 一行出全", () => {
    expect(q.stats.sql).toContain("AS total");
    expect(q.stats.sql).toContain("AS last30d");
    expect(q.stats.sql).toContain("AS lastEventDate");
    expect(q.stats.sql).toContain("AS earliest");
    expect(q.stats.sql).toContain("AS latest");
    expect(q.stats.params).toEqual([
      "anthropic",
      "anthropic",
      "2026-07-29",
      "anthropic",
      "anthropic",
      "anthropic",
    ]);
  });

  it("categoryDistribution：按 category 分组计数，计数倒序", () => {
    expect(q.categoryDistribution.sql).toContain("GROUP BY i.category");
    expect(q.categoryDistribution.sql).toContain("ORDER BY count DESC, category ASC");
    expect(q.categoryDistribution.params).toEqual(["anthropic"]);
  });

  it("coworkers：排除自身、按次数倒序、LIMIT 8", () => {
    expect(q.coworkers.sql).toContain("ic2.company_id <> ic1.company_id");
    expect(q.coworkers.sql).toContain("ORDER BY count DESC, companyId ASC");
    expect(q.coworkers.sql).toContain("LIMIT 8");
    expect(q.coworkers.params).toEqual(["anthropic"]);
  });

  it("注入安全：恶意 companyId 在四条语句中均只进 params", () => {
    const evil = buildCompanyProfileQueries(EVIL, { last30dFrom: "2026-07-29" });
    for (const stmt of Object.values(evil)) {
      expect(stmt.sql).not.toContain("DROP TABLE");
      expect(stmt.params).toContain(EVIL);
    }
  });
});

describe("chunkArray + MAX_BOUND_PARAMS（D1 绑定参数上限防护）", () => {
  it("MAX_BOUND_PARAMS 不超过 D1 单查询 100 绑定参数上限", () => {
    expect(MAX_BOUND_PARAMS).toBeLessThanOrEqual(100);
    expect(MAX_BOUND_PARAMS).toBeGreaterThan(0);
  });

  it("均匀切分且保序：[1..5] size=2 → [[1,2],[3,4],[5]]", () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("整除时无空尾块；空数组 → 空结果", () => {
    expect(chunkArray([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
    expect(chunkArray([], 90)).toEqual([]);
  });

  it("size 大于数组长度 → 单块原样", () => {
    expect(chunkArray(["a"], 90)).toEqual([["a"]]);
  });
});

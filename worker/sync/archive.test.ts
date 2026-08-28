// parseArchiveDates TDD 测试（spec02 2.1）
// 真实 archive 页样本断言（条数 > 50、首条 ≥ 2026-08-27）+ inline 边界（去重、倒序、无日期 → []）。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseArchiveDates } from "./archive";

const fixtureHtml = readFileSync(
  new URL("./fixtures/archive-sample.html", import.meta.url),
  "utf8",
);

describe("parseArchiveDates · 真实样本", () => {
  it("条数 > 50 且首条 ≥ 2026-08-27（spec 2.1 下限）", () => {
    const dates = parseArchiveDates(fixtureHtml);
    expect(dates.length).toBeGreaterThan(50);
    expect(dates[0] >= "2026-08-27").toBe(true);
  });

  it("去重后 72 条（写死防漏读），全部为 YYYY-MM-DD 且严格倒序", () => {
    const dates = parseArchiveDates(fixtureHtml);
    expect(dates).toHaveLength(72); // 抓取时点（2026-08-28）期数；spec 下限 > 50
    for (const d of dates) expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i - 1] > dates[i]).toBe(true); // 严格倒序：同日期已在去重阶段合并
    }
  });
});

describe("parseArchiveDates · inline 边界", () => {
  it("同一日期出现多次（href/文本/meta）→ 去重为一条", () => {
    const html =
      '<li><a href="https://daily.juya.uk/issues/2026-08-28/">AI 早报 2026-08-28</a>' +
      ' <span class="meta">2026-08-28</span> <a href="https://daily.juya.uk/markdown/2026-08-28.md">Markdown</a></li>';
    expect(parseArchiveDates(html)).toEqual(["2026-08-28"]);
  });

  it("多条日期按倒序输出（输入乱序）", () => {
    const html =
      '<a href="/issues/2026-01-02/">2026-01-02</a>' +
      '<a href="/issues/2025-12-31/">2025-12-31</a>' +
      '<a href="/issues/2026-08-01/">2026-08-01</a>';
    expect(parseArchiveDates(html)).toEqual(["2026-08-01", "2026-01-02", "2025-12-31"]);
  });

  it("无日期 → []", () => {
    expect(parseArchiveDates("<html><body>空空如也</body></html>")).toEqual([]);
    expect(parseArchiveDates("")).toEqual([]);
  });
});

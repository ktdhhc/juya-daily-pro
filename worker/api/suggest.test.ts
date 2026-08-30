// suggest 纯函数测试（spec11 契约 C，TDD 先红后绿）。
// 覆盖：summarizeMatch 摘要片段（命中开头/中间/结尾/大小写/无命中/空输入/截断）与
// buildSuggestQuery SQL 形状（published 过滤、title 命中优先、LIKE 转义、参数绑定）。
import { describe, expect, it } from "vitest";
import { summarizeMatch } from "./suggest";
import { buildSuggestQuery } from "./queries";

describe("summarizeMatch（摘要命中片段）", () => {
  const pad = (prefix: string, suffix: string): string =>
    prefix + "关键词" + suffix; // 长度可控的命中摘要

  it("命中中间：前后各约 40 字符截断，两侧省略号", () => {
    const summary = pad("甲".repeat(60), "乙".repeat(60));
    const out = summarizeMatch(summary, "关键词");
    expect(out.startsWith("…")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
    expect(out).toContain("关键词");
    expect(out.length).toBe(40 + 3 + 40 + 2); // 前后窗 + 命中词 + 两侧省略号
  });

  it("命中开头：无前省略号", () => {
    const out = summarizeMatch("关键词" + "乙".repeat(60), "关键词");
    expect(out.startsWith("关键词")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
  });

  it("命中结尾：无后省略号", () => {
    const out = summarizeMatch("甲".repeat(60) + "关键词", "关键词");
    expect(out.startsWith("…")).toBe(true);
    expect(out.endsWith("关键词")).toBe(true);
  });

  it("大小写不敏感命中", () => {
    expect(summarizeMatch("We love OpenAI models", "openai")).toContain("OpenAI");
  });

  it("无命中且超长 → 前 80 字符 + 省略号；不超长 → 原样", () => {
    const long = "丙".repeat(120);
    const out = summarizeMatch(long, "不存在");
    expect(out).toBe("丙".repeat(80) + "…");
    expect(summarizeMatch("短摘要", "不存在")).toBe("短摘要");
  });

  it("空 summary → 空串；空白 q 按无命中处理", () => {
    expect(summarizeMatch("", "词")).toBe("");
    expect(summarizeMatch("某摘要", "  ")).toBe("某摘要");
  });
});

describe("buildSuggestQuery（联想构造器）", () => {
  it("SQL 形状：published=1 过滤 + title 命中优先 + ESCAPE + 排序 + LIMIT", () => {
    const q = buildSuggestQuery("OpenAI", 8);
    expect(q.sql).toContain("published = 1");
    expect(q.sql).toContain("CASE WHEN title LIKE");
    expect(q.sql).toContain("ESCAPE '\\'");
    expect(q.sql).toContain("ORDER BY titleHit ASC, date DESC");
    expect(q.sql).toContain("LIMIT ?");
    expect(q.params).toEqual(["%OpenAI%", "%OpenAI%", "%OpenAI%", 8]);
  });

  it("LIKE 通配符按字面转义（%/_/\\）", () => {
    const q = buildSuggestQuery("50%", 8);
    expect(q.params[0]).toBe("%50\\%%");
  });

  it("注入安全：恶意 q 只进绑定参数，SQL 文本不含原始输入", () => {
    const evil = "'; DROP TABLE items; --";
    const q = buildSuggestQuery(evil, 8);
    expect(q.sql).not.toContain(evil);
    expect(q.params).toContain(`%${evil}%`);
  });
});

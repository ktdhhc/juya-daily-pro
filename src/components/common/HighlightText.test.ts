import { describe, expect, it } from "vitest";
import { matchRanges } from "./HighlightText";

describe("matchRanges（高亮命中位置计算，spec11 契约 F）", () => {
  it("单次命中 → [start, end)", () => {
    expect(matchRanges("OpenAI 发布新模型", "发布")).toEqual([[7, 9]]);
  });

  it("多次命中 → 多段不重叠区间", () => {
    expect(matchRanges("AI 日报：AI 与 Agent", "AI")).toEqual([
      [0, 2],
      [6, 8],
    ]);
  });

  it("大小写不敏感（按原文切分用于渲染）", () => {
    expect(matchRanges("We love OpenAI models", "openai")).toEqual([[8, 14]]);
  });

  it("空 query / 纯空白 query / 无命中 → 空数组", () => {
    expect(matchRanges("任意文本", "")).toEqual([]);
    expect(matchRanges("任意文本", "  ")).toEqual([]);
    expect(matchRanges("任意文本", "不存在")).toEqual([]);
  });
});

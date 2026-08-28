// matchAll TDD 测试（spec03 Step 4.1）：纯编排——对每条 Item 调 ownersByMatching，
// 聚合为 SQL 所需结构（ownerRows 展平 + ok/missing 分档）。构造 3 条 Item（0/1/2 家命中）。
import { describe, expect, it } from "vitest";
import { matchAll } from "./match";
import type { Company } from "../../src/lib/schema";

const companyOf = (over: Partial<Company>): Company => ({
  id: "anthropic",
  name: "Anthropic",
  aliases: ["Anthropic", "Claude"],
  color: "#D97757",
  status: "active",
  notes: "一句话定位",
  ...over,
});

const registry: Company[] = [
  companyOf({}),
  companyOf({ id: "openai", name: "OpenAI", aliases: ["OpenAI", "GPT"] }),
];

const itemOf = (id: string, title: string, bodyMd = "") => ({ id, title, bodyMd });

describe("matchAll", () => {
  it("0/1/2 家命中：ownerRows 按 (itemId, companyId) 展平，okIds / missingIds 分档", () => {
    const items = [
      itemOf("20260827-1", "与白名单无关的动态"), // 0 家命中
      itemOf("20260827-2", "Anthropic 发布新模型"), // 1 家命中
      itemOf("20260827-3", "Anthropic 与 OpenAI 同台"), // 2 家命中
    ];
    const r = matchAll(items, registry);
    expect(r.missingIds).toEqual(["20260827-1"]);
    expect(r.okIds).toEqual(["20260827-2", "20260827-3"]);
    expect(r.ownerRows).toEqual([
      { itemId: "20260827-2", companyId: "anthropic" },
      { itemId: "20260827-3", companyId: "anthropic" },
      { itemId: "20260827-3", companyId: "openai" },
    ]);
  });

  it("同公司多别名命中 → 每 (item, company) 只聚合一行", () => {
    const r = matchAll([itemOf("20260827-4", "Anthropic 的 Claude", "Claude 再度更新")], registry);
    expect(r.ownerRows).toEqual([{ itemId: "20260827-4", companyId: "anthropic" }]);
    expect(r.okIds).toEqual(["20260827-4"]);
    expect(r.missingIds).toEqual([]);
  });

  it("retired 公司不产生 ownerRows；空输入 → 三空", () => {
    const withRetired = [
      ...registry,
      companyOf({ id: "dead", name: "Dead", aliases: ["Fable"], status: "retired" }),
    ];
    expect(matchAll([itemOf("20260827-5", "Fable 相关动态")], withRetired)).toEqual({
      ownerRows: [],
      okIds: [],
      missingIds: ["20260827-5"],
    });
    expect(matchAll([], registry)).toEqual({ ownerRows: [], okIds: [], missingIds: [] });
  });
});

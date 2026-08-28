// gen-registry TDD 测试（spec02 3.2）
// validateRegistry 校验规则：id 为 slug 格式、name/aliases 非空、color 为 hex、
// status ∈ active|dormant|retired；问题逐条列出（空数组 = 合法）。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { validateRegistry } from "./gen-registry";

// 合法条目构造器：缺省全合法，按需覆盖制造非法用例
const companyOf = (over: Record<string, unknown> = {}) => ({
  id: "zhipu",
  name: "智谱",
  aliases: ["Zhipu AI", "/GLM-?\\d/"],
  color: "#2563EB",
  status: "active",
  notes: "一句话定位",
  ...over,
});

describe("validateRegistry", () => {
  it("合法条目 → 无问题", () => {
    expect(validateRegistry([companyOf()])).toEqual([]);
  });

  it("输入非数组 → 单条问题", () => {
    expect(validateRegistry({ companies: [] })).toHaveLength(1);
    expect(validateRegistry(null)[0]).toContain("数组");
  });

  it("id 非 slug（大写 / 空格 / 空串 / 连续连字符）→ 全部报 id，且带条目下标", () => {
    const problems = validateRegistry([
      companyOf({ id: "Anthropic" }),
      companyOf({ id: "with space" }),
      companyOf({ id: "" }),
      companyOf({ id: "dou--ble" }),
    ]);
    expect(problems.length).toBe(4);
    expect(problems.every((p) => p.includes("id"))).toBe(true);
    expect(problems.some((p) => p.includes("companies[0]"))).toBe(true);
    expect(problems.some((p) => p.includes("companies[2]"))).toBe(true);
  });

  it("id 重复 → 报重复并指向后出现的条目", () => {
    const problems = validateRegistry([companyOf(), companyOf({ id: "zhipu" })]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("companies[1]");
    expect(problems[0]).toContain("重复");
  });

  it("name 缺失 / 空白 → 报 name", () => {
    const problems = validateRegistry([
      companyOf({ id: "c1", name: undefined }),
      companyOf({ id: "c2", name: "   " }),
    ]);
    expect(problems).toHaveLength(2);
    expect(problems.every((p) => p.includes("name"))).toBe(true);
  });

  it("aliases 非数组 / 空数组 / 含空串 / 含非字符串 → 报 aliases", () => {
    const problems = validateRegistry([
      companyOf({ id: "c1", aliases: "Claude" }),
      companyOf({ id: "c2", aliases: [] }),
      companyOf({ id: "c3", aliases: ["Claude", "   "] }),
      companyOf({ id: "c4", aliases: ["Claude", 42] }),
    ]);
    expect(problems).toHaveLength(4);
    expect(problems.every((p) => p.includes("aliases"))).toBe(true);
  });

  it("color 非 hex（缺 # / 位数不足 / 非法字符）→ 报 color", () => {
    const problems = validateRegistry([
      companyOf({ id: "c1", color: "D97757" }),
      companyOf({ id: "c2", color: "#12345" }),
      companyOf({ id: "c3", color: "#12G45Z" }),
    ]);
    expect(problems).toHaveLength(3);
    expect(problems.every((p) => p.includes("color"))).toBe(true);
  });

  it("status 枚举外（大小写敏感）→ 报 status", () => {
    const problems = validateRegistry([
      companyOf({ id: "c1", status: "Active" }),
      companyOf({ id: "c2", status: "unknown" }),
      companyOf({ id: "c3", status: undefined }),
    ]);
    expect(problems).toHaveLength(3);
    expect(problems.every((p) => p.includes("status"))).toBe(true);
  });

  it("条目非对象 → 报条目形态", () => {
    const problems = validateRegistry([companyOf(), "anthropic"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("companies[1]");
    expect(problems[0]).toContain("对象");
  });

  it("真实 data/companies.yaml 校验通过（真相源守护）", () => {
    const text = readFileSync(new URL("../data/companies.yaml", import.meta.url), "utf8");
    const doc = parse(text) as { companies: unknown };
    expect(validateRegistry(doc.companies)).toEqual([]);
  });
});

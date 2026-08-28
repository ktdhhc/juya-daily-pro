// registry 生成物防回归测试（spec02 3.3）。
// 断言 REGISTRY ≥ 25 条、字段形状与枚举合法——防止 codegen 漂移或手改生成物。
import { describe, expect, it } from "vitest";
import { REGISTRY } from "./registry.generated";

const RE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RE_HEX = /^#[0-9a-fA-F]{6}$/;
const STATUSES = ["active", "dormant", "retired"];

describe("REGISTRY（worker/registry.generated.ts）", () => {
  it("条目数 ≥ 25", () => {
    expect(REGISTRY.length).toBeGreaterThanOrEqual(25);
  });

  it("id：slug 格式且全局唯一", () => {
    const ids = REGISTRY.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(RE_SLUG);
  });

  it("name / notes：非空字符串", () => {
    for (const c of REGISTRY) {
      expect(typeof c.name).toBe("string");
      expect(c.name.trim().length).toBeGreaterThan(0);
      expect(typeof c.notes).toBe("string");
    }
  });

  it("aliases：非空数组且元素为非空字符串", () => {
    for (const c of REGISTRY) {
      expect(Array.isArray(c.aliases)).toBe(true);
      expect(c.aliases.length).toBeGreaterThan(0);
      for (const a of c.aliases) {
        expect(typeof a).toBe("string");
        expect(a.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("color：6 位 hex", () => {
    for (const c of REGISTRY) expect(c.color).toMatch(RE_HEX);
  });

  it("status：枚举合法", () => {
    for (const c of REGISTRY) expect(STATUSES).toContain(c.status);
  });
});

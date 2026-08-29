// requireAdmin TDD 测试（spec07 Step 1.1）：服务端守卫统一为 ADMIN_TOKEN 的纯函数核心。
// 四分支：env 空 → 本地全开放 / env 非空 + 头正确 / 头错误 / 头缺失（null）。
import { describe, expect, it } from "vitest";
import { requireAdmin } from "./auth";

describe("requireAdmin", () => {
  it("envToken 未定义或空串 → 本地全开放（恒 true）", () => {
    expect(requireAdmin(undefined, null)).toBe(true);
    expect(requireAdmin(undefined, "任意值也放行")).toBe(true);
    expect(requireAdmin("", null)).toBe(true);
    expect(requireAdmin("", "wrong")).toBe(true);
  });

  it("envToken 非空 + headerToken 严格相等 → true", () => {
    expect(requireAdmin("test-token", "test-token")).toBe(true);
  });

  it("envToken 非空 + headerToken 不等 → false", () => {
    expect(requireAdmin("test-token", "wrong-token")).toBe(false);
    expect(requireAdmin("test-token", "")).toBe(false);
  });

  it("envToken 非空 + headerToken 缺失（null）→ false", () => {
    expect(requireAdmin("test-token", null)).toBe(false);
  });
});

// 缝 3（spec15 Testing Decisions）：Pages 代理的路径前缀校验纯函数。
// 只断言外部行为：输入 pathname → 是否放行；不耦合内部实现。
import { describe, expect, it } from "vitest";
import { isApiPath } from "./api-path";

describe("isApiPath", () => {
  it("放行 /api/ 前缀下的具体路径", () => {
    expect(isApiPath("/api/companies")).toBe(true);
    expect(isApiPath("/api/daily/2026-09-08")).toBe(true);
    expect(isApiPath("/api/")).toBe(true);
  });

  it("放行裸 /api（与 Cloudflare /api/* 路由规则一致：裸前缀同样命中）", () => {
    expect(isApiPath("/api")).toBe(true);
  });

  it("拒绝协议相对路径（// 开头会改写 fetch 目标主机，防 SSRF）", () => {
    expect(isApiPath("//evil.example.com/api/x")).toBe(false);
  });

  it("拒绝前缀形近路径与非 API 路径", () => {
    expect(isApiPath("/api-docs/x")).toBe(false);
    expect(isApiPath("/apix")).toBe(false);
    expect(isApiPath("/companies")).toBe(false);
  });

  it("区分大小写", () => {
    expect(isApiPath("/API/companies")).toBe(false);
    expect(isApiPath("/Api/companies")).toBe(false);
  });

  it("拒绝空字符串", () => {
    expect(isApiPath("")).toBe(false);
  });
});

// admin token 存取 TDD 测试（spec07 Step 2.1）
// 覆盖 4 类：存→取一致 / 清空后取空串 / 空串视为非管理员 / 非空视为管理员；
// 另测缺省走 globalThis.localStorage。node 环境无 localStorage，store 一律注入（Map 造 fake）。
import { describe, expect, it } from "vitest";
import { clearAdminToken, getAdminToken, isAdmin, setAdminToken, type TokenStore } from "./auth";

// Map 造 fake store：与 localStorage 同形（getItem 缺 key 返回 null），并留出 map 便于断言 key 名
const fakeStore = (): TokenStore & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
};

describe("admin token 存取（spec07 2.1）", () => {
  it("1. 存→取一致，且落在 juya-admin-token key 上", () => {
    const s = fakeStore();
    setAdminToken("t-ok-123", s);
    expect(s.map.get("juya-admin-token")).toBe("t-ok-123");
    expect(getAdminToken(s)).toBe("t-ok-123");
  });

  it("2. 未存过取空串；清空后取空串", () => {
    const s = fakeStore();
    expect(getAdminToken(s)).toBe("");
    setAdminToken("t-x", s);
    clearAdminToken(s);
    expect(getAdminToken(s)).toBe("");
  });

  it("3. 空串视为非管理员", () => {
    const s = fakeStore();
    setAdminToken("", s);
    expect(isAdmin(s)).toBe(false);
  });

  it("4. 非空视为管理员", () => {
    const s = fakeStore();
    setAdminToken("t-y", s);
    expect(isAdmin(s)).toBe(true);
  });

  it("5. store 缺省时走 globalThis.localStorage", () => {
    const s = fakeStore();
    const g = globalThis as { localStorage?: TokenStore };
    const original = g.localStorage;
    g.localStorage = s;
    try {
      setAdminToken("t-default");
      expect(getAdminToken()).toBe("t-default");
      expect(isAdmin()).toBe(true);
      clearAdminToken();
      expect(isAdmin()).toBe(false);
    } finally {
      g.localStorage = original;
    }
  });
});

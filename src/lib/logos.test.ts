// LOGOS 生成物防回归测试（npm run logos:fetch 产物）。
// 只查映射一致性：key ⊆ registry ids、值均为站内 /logos/ 图片路径、文件真实存在于 public/logos/。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LOGOS } from "./logos.generated";
import { REGISTRY } from "./registry.generated";

describe("LOGOS（src/lib/logos.generated.ts）", () => {
  it("key 集合 ⊆ registry ids", () => {
    const ids = new Set(REGISTRY.map((c) => c.id));
    for (const id of Object.keys(LOGOS)) {
      expect(ids.has(id), `LOGOS 含未知公司 id: ${id}`).toBe(true);
    }
  });

  it("值均为站内 /logos/ 路径且指向已存在的文件", () => {
    expect(Object.keys(LOGOS).length).toBeGreaterThan(0);
    for (const [id, path] of Object.entries(LOGOS)) {
      expect(path).toMatch(/^\/logos\/[a-z0-9-]+\.(png|jpe?g|svg|webp|avif|gif|ico)$/);
      expect(() => readFileSync(new URL(`../../public${path}`, import.meta.url)), `${id} → ${path}`).not.toThrow();
    }
  });
});

// wrangler-cli 纯函数测试（spec15 缝 1，TDD 先红后绿）。
// 只测 parseDbTarget：输入 argv → 输出数据库目标字符串（--local / --remote）；
// 只断言外部行为，不耦合内部结构、不触网、不读配置。
import { describe, expect, it } from "vitest";
import { parseDbTarget } from "./wrangler-cli";

describe("parseDbTarget（命令行数据库目标解析）", () => {
  it("缺省（无参数）→ 本地 --local", () => {
    expect(parseDbTarget([])).toBe("--local");
  });

  it("显式 --remote → 远端", () => {
    expect(parseDbTarget(["--remote"])).toBe("--remote");
  });

  it("混入其他参数（--dates= / --limit= / --force / --item=）→ 仍为本地", () => {
    const argv = ["--dates=2026-09-01,2026-09-02", "--limit=5", "--force", "--item=abc"];
    expect(parseDbTarget(argv)).toBe("--local");
  });

  it("--remote 与其他参数混排（部署日 `--dates=… --remote` 真实用法）→ 远端", () => {
    expect(parseDbTarget(["--dates=2026-09-01", "--remote"])).toBe("--remote");
  });
});

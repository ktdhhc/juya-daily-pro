// registry-apply 纯函数测试（spec16 票 04，TDD 先红后绿）。
// 只测 selectCandidatesToRegister：给定新 registry 的公司 id 集合与待处置候选清单
// → 返回应标记为已入册的候选 id（只认 id 精确命中；输入顺序稳定、去重）。
// 只断言外部行为，不触网、不读配置、不起子进程（编排属薄 IO，ADR-0011）。
import { describe, expect, it } from "vitest";
import { selectCandidatesToRegister } from "./registry-apply";

describe("selectCandidatesToRegister（候选回填判定）", () => {
  it("候选 id 精确命中新 registry → 返回该 id", () => {
    expect(selectCandidatesToRegister(new Set(["runway"]), ["runway"])).toEqual(["runway"]);
  });

  it("候选 id 不在 registry → 保持待处置（返回空）", () => {
    expect(selectCandidatesToRegister(new Set(["openai"]), ["runway"])).toEqual([]);
  });

  it("只认精确命中：大小写 / 前后缀 / 连字符变体都不算", () => {
    const registry = new Set(["runway"]);
    expect(
      selectCandidatesToRegister(registry, ["Runway", "runway-ai", "run", "runways", "run-way"]),
    ).toEqual([]);
  });

  it("输出保持输入顺序（不排序）", () => {
    const registry = new Set(["zhipu", "cloudflare"]);
    expect(selectCandidatesToRegister(registry, ["zhipu", "manus", "cloudflare"])).toEqual([
      "zhipu",
      "cloudflare",
    ]);
  });

  it("候选清单含重复 id → 输出去重", () => {
    expect(selectCandidatesToRegister(new Set(["runway"]), ["runway", "runway"])).toEqual(["runway"]);
  });

  it("空 registry / 空候选清单 → 空", () => {
    expect(selectCandidatesToRegister(new Set(), ["runway"])).toEqual([]);
    expect(selectCandidatesToRegister(new Set(["runway"]), [])).toEqual([]);
  });
});

// candidateRegisteredSql（code-review P1）：已忽略的候选也随人工入册回填 registered
import { candidateRegisteredSql } from "./registry-apply";

describe("candidateRegisteredSql", () => {
  it("只改候选状态，且允许 pending 与 dismissed 两档回填（已入册不重复覆盖）", () => {
    const sql = candidateRegisteredSql(["runway", "inception-labs"]);
    expect(sql).toContain("SET status = 'registered'");
    expect(sql).toContain("WHERE status IN ('pending','dismissed')");
    expect(sql).toContain("'runway', 'inception-labs'");
    expect(sql.includes("\n")).toBe(false);
    expect(sql.endsWith(";")).toBe(true);
  });

  it("单引号转义", () => {
    expect(candidateRegisteredSql(["it's"])).toContain("'it''s'");
  });
});

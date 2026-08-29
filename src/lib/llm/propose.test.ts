// propose TDD 测试（spec09 Step 3.1，ADR-0011 单测一律不调真实 LLM）
// 覆盖：buildProposePrompt 快照（registry 名单 + 三分类说明）与 4000 字符截断边界、
// parseProposeResponse 全分支（三分类合法 / 幻觉 parent / 非 slug id / 非法 JSON / kind 未知）。
// 与 src/lib/llm/enrich.test.ts 同层风格。
import { describe, expect, it } from "vitest";
import { buildProposePrompt, parseProposeResponse, type ProposeItem } from "./propose";

// registry 名单样例：真实名单来自 D1 companies 表（与 data/companies.yaml 同步），测试取子集
const registryNames = ["OpenAI", "腾讯", "月之暗面"];

const sampleItem: ProposeItem = {
  title: "Perplexity 发布 Comet 浏览器",
  summary: "Perplexity 推出 AI 浏览器 Comet，面向 Pro 用户开放下载。",
  bodyMd:
    "AI 搜索公司 Perplexity 发布 Comet 浏览器，内置 Assistant 助手可代用户执行订票、整理标签页等操作。" +
    "Comet 本周起面向 Max 订阅用户开放，其余用户可加入候补名单。",
};

// ---------- buildProposePrompt ----------

describe("buildProposePrompt", () => {
  it("快照：system 含 JSON 约定与三分类，user 含标题/摘要/正文、registry 名单与任务说明", () => {
    const { system, user } = buildProposePrompt(sampleItem, registryNames);
    expect(system).toContain("JSON");
    expect(system).toContain('"company"');
    expect(system).toContain('"product"');
    expect(system).toContain('"ignore"');
    expect(user).toContain(sampleItem.title);
    expect(user).toContain(sampleItem.summary);
    expect(user).toContain(sampleItem.bodyMd); // 短正文 < 4000 → 全文在场
    expect(user).toContain("OpenAI");
    expect(user).toContain("腾讯");
    expect(user).toContain("月之暗面");
    expect(user).toContain("parent");
    expect(user).toContain("evidence");
  });

  it("bodyMd 恰 4000 字符 → 不截断，全文在场", () => {
    const item: ProposeItem = { title: "t", summary: "s", bodyMd: "Y".repeat(4000) };
    const { user } = buildProposePrompt(item, registryNames);
    expect(user).toContain("Y".repeat(4000));
  });

  it("bodyMd 4001 字符 → 截断到 4000，第 4001 字符起的尾巴不出现", () => {
    const item: ProposeItem = { title: "t", summary: "s", bodyMd: "X".repeat(4001) + "TAILMARK" };
    const { user } = buildProposePrompt(item, registryNames);
    expect(user).toContain("X".repeat(4000));
    expect(user).not.toContain("X".repeat(4001));
    expect(user).not.toContain("TAILMARK");
  });
});

// ---------- parseProposeResponse ----------

describe("parseProposeResponse", () => {
  it("company 合法 → 返回建议值（id/name/aliases/evidence 原样）", () => {
    const raw =
      '{"kind":"company","id":"perplexity","name":"Perplexity","aliases":["Perplexity AI","Comet"],"evidence":"AI 搜索公司，发布 Comet 浏览器"}';
    expect(parseProposeResponse(raw, registryNames)).toEqual({
      kind: "company",
      id: "perplexity",
      name: "Perplexity",
      aliases: ["Perplexity AI", "Comet"],
      evidence: "AI 搜索公司，发布 Comet 浏览器",
    });
  });

  it("company 缺 aliases → 返回空数组（别名可后补）；aliases 非数组 → null", () => {
    expect(
      parseProposeResponse(
        '{"kind":"company","id":"perplexity","name":"Perplexity","evidence":"AI 搜索公司"}',
        registryNames,
      ),
    ).toEqual({
      kind: "company",
      id: "perplexity",
      name: "Perplexity",
      aliases: [],
      evidence: "AI 搜索公司",
    });
    expect(
      parseProposeResponse(
        '{"kind":"company","id":"foo","name":"Foo","aliases":"Foo","evidence":"x"}',
        registryNames,
      ),
    ).toBeNull();
  });

  it("```json 围栏包裹 → 剥围栏后解析", () => {
    expect(parseProposeResponse('```json\n{"kind":"ignore"}\n```', registryNames)).toEqual({
      kind: "ignore",
    });
  });

  it("product 合法（parent ∈ registryNames）→ 返回 parent + evidence", () => {
    const raw = '{"kind":"product","parent":"OpenAI","evidence":"Sora 是 OpenAI 的视频模型"}';
    expect(parseProposeResponse(raw, registryNames)).toEqual({
      kind: "product",
      parent: "OpenAI",
      evidence: "Sora 是 OpenAI 的视频模型",
    });
  });

  it("幻觉 parent（不在 registryNames）→ null（不可信）", () => {
    const raw = '{"kind":"product","parent":"Perplexity","evidence":"Comet 是 Perplexity 的浏览器"}';
    expect(parseProposeResponse(raw, registryNames)).toBeNull();
  });

  it("company id 非 slug（大写/空格）→ null", () => {
    expect(
      parseProposeResponse(
        '{"kind":"company","id":"Thinking Machines","name":"Thinking Machines","evidence":"x"}',
        registryNames,
      ),
    ).toBeNull();
  });

  it("company name 空白 → null", () => {
    expect(
      parseProposeResponse('{"kind":"company","id":"foo","name":"  ","evidence":"x"}', registryNames),
    ).toBeNull();
  });

  it("company / product 缺 evidence 或纯空白 → null", () => {
    expect(
      parseProposeResponse('{"kind":"company","id":"foo","name":"Foo"}', registryNames),
    ).toBeNull();
    expect(
      parseProposeResponse('{"kind":"product","parent":"OpenAI","evidence":"  "}', registryNames),
    ).toBeNull();
  });

  it("非法 JSON → null", () => {
    expect(parseProposeResponse("{kind: company}", registryNames)).toBeNull();
    expect(parseProposeResponse("抱歉，我无法输出 JSON", registryNames)).toBeNull();
  });

  it("JSON 合法但不是对象（字符串/数组）→ null", () => {
    expect(parseProposeResponse('"ignore"', registryNames)).toBeNull();
    expect(parseProposeResponse('["ignore"]', registryNames)).toBeNull();
  });

  it("kind 未知 / 缺 kind → null", () => {
    expect(
      parseProposeResponse('{"kind":"brand","parent":"OpenAI","evidence":"x"}', registryNames),
    ).toBeNull();
    expect(parseProposeResponse('{"parent":"OpenAI","evidence":"x"}', registryNames)).toBeNull();
  });
});

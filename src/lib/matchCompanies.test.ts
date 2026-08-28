// matchCompanies TDD 测试（spec03 Step 1 / ADR-0011 用例清单）
// 覆盖 9 类：字面量命中、正则两种形态、混合 registry、同公司多别名聚合、retired 跳过、
// 0 命中、≥2 家并列且无 role（ADR-0014）、大小写不敏感、字面量特殊正则字符不解释。
import { describe, expect, it } from "vitest";
import { matchCandidates, ownersByMatching } from "./matchCompanies";
import type { Company } from "./schema";

// Company 构造器：缺省填合法值，便于按需覆盖
const companyOf = (over: Partial<Company>): Company => ({
  id: "anthropic",
  name: "Anthropic",
  aliases: ["Anthropic"],
  color: "#D97757",
  status: "active",
  notes: "一句话定位",
  ...over,
});

describe("matchCandidates", () => {
  it("1. 字面量 alias 命中 title 任意位置", () => {
    const registry = [companyOf({})];
    const hits = matchCandidates(
      { title: "Anthropic 发布新模型", bodyMd: "正文未提" },
      registry,
    );
    expect(hits).toEqual([{ companyId: "anthropic", matchedAliases: ["Anthropic"] }]);
  });

  it("1. 字面量 alias 命中 bodyMd 任意位置（title 不含）", () => {
    const registry = [companyOf({})];
    const hits = matchCandidates(
      { title: "今日要闻速览", bodyMd: "开头一段。\n\n文中提到 Anthropic 的动态。" },
      registry,
    );
    expect(hits.map((h) => h.companyId)).toEqual(["anthropic"]);
  });

  it("2. 正则 alias 命中：/…/ 形态", () => {
    const registry = [companyOf({ id: "openai", name: "OpenAI", aliases: ["/GPT-?[45]/"] })];
    const hits = matchCandidates({ title: "OpenAI 发布 GPT-5", bodyMd: "" }, registry);
    expect(hits.map((h) => h.companyId)).toEqual(["openai"]);
  });

  it("2. 正则 alias 命中：/…/i 形态", () => {
    const registry = [companyOf({ id: "xai", name: "xAI", aliases: ["/grok-\\d+/i"] })];
    const hits = matchCandidates({ title: "Grok-3 上线", bodyMd: "" }, registry);
    expect(hits.map((h) => h.companyId)).toEqual(["xai"]);
  });

  it("3. 字面量与正则混合 registry 下同时生效（两家分别经两种形态命中）", () => {
    const registry = [
      companyOf({}), // 字面量 alias "Anthropic"
      companyOf({ id: "openai", name: "OpenAI", aliases: ["/GPT-?\\d/"] }), // 正则 alias
    ];
    const hits = matchCandidates(
      { title: "Anthropic 与 OpenAI 的 GPT-5 同日发布", bodyMd: "" },
      registry,
    );
    expect(hits).toHaveLength(2);
    const ids = hits.map((h) => h.companyId);
    expect(ids).toContain("anthropic");
    expect(ids).toContain("openai");
  });

  it("4. 同公司多别名命中 → 聚合为一条结果（matchedAliases 多条）", () => {
    const registry = [companyOf({ aliases: ["Anthropic", "Claude"] })];
    const hits = matchCandidates(
      { title: "Anthropic 发布", bodyMd: "Claude 系列更新" },
      registry,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.companyId).toBe("anthropic");
    expect(hits[0]?.matchedAliases).toHaveLength(2);
  });

  it("5. retired 公司不参与匹配", () => {
    const registry = [
      companyOf({ status: "retired", aliases: ["Fable"] }),
      companyOf({ id: "moonshot", name: "月之暗面", aliases: ["Kimi"] }),
    ];
    const hits = matchCandidates({ title: "Fable 与 Kimi 同台", bodyMd: "" }, registry);
    expect(hits.map((h) => h.companyId)).toEqual(["moonshot"]);
  });

  it("6. 0 命中 → 空数组", () => {
    const registry = [companyOf({})];
    expect(matchCandidates({ title: "与白名单无关的新闻", bodyMd: "正文也不含别名" }, registry)).toEqual(
      [],
    );
    expect(ownersByMatching({ title: "与白名单无关的新闻", bodyMd: "正文也不含别名" }, registry)).toEqual(
      [],
    );
  });

  it("8. 大小写不敏感：小写文本命中首字母大写 alias", () => {
    const registry = [companyOf({})];
    const hits = matchCandidates({ title: "anthropic 开源新项目", bodyMd: "" }, registry);
    expect(hits.map((h) => h.companyId)).toEqual(["anthropic"]);
  });

  it("8. 大小写不敏感：全大写文本命中混合大小写 alias", () => {
    const registry = [companyOf({ id: "openai", name: "OpenAI", aliases: ["OpenAI"] })];
    const hits = matchCandidates({ title: "OPENAI 官宣", bodyMd: "" }, registry);
    expect(hits.map((h) => h.companyId)).toEqual(["openai"]);
  });

  it("9. 字面量含正则特殊字符（C++）不被解释，按字面量命中", () => {
    const registry = [companyOf({ id: "cpp-thing", name: "C++ Tool", aliases: ["C++"] })];
    const hits = matchCandidates({ title: "C++ 编译器加速", bodyMd: "" }, registry);
    expect(hits.map((h) => h.companyId)).toEqual(["cpp-thing"]);
  });

  it("9. 字面量特殊字符不解释：alias 的 . 不作任意字符通配", () => {
    const registry = [companyOf({ id: "ver", name: "Ver", aliases: ["3.5"] })];
    // 若 "." 被当作正则通配符，"3x5" 会被误命中
    expect(matchCandidates({ title: "版本 3x5 发布", bodyMd: "" }, registry)).toEqual([]);
    expect(matchCandidates({ title: "升级到 3.5 版本", bodyMd: "" }, registry).map((h) => h.companyId)).toEqual(
      ["ver"],
    );
  });
});

describe("ownersByMatching", () => {
  it("7. ≥2 家命中 → 并列 owner 数组且全部无 role 字段（ADR-0014）", () => {
    const registry = [
      companyOf({}),
      companyOf({ id: "openai", name: "OpenAI", aliases: ["OpenAI"] }),
    ];
    const owners = ownersByMatching(
      { title: "Anthropic 与 OpenAI 达成合作", bodyMd: "" },
      registry,
    );
    expect(owners).toHaveLength(2);
    const ids = owners.map((o) => o.company);
    expect(ids).toContain("anthropic");
    expect(ids).toContain("openai");
    for (const o of owners) {
      expect("role" in o).toBe(false); // ADR-0014：v1 并列归属 role 全 NULL（字段不出现）
    }
  });

  it("单家命中 → 单 owner 且无 role 字段（role 缺省）", () => {
    const registry = [companyOf({})];
    const owners = ownersByMatching({ title: "Anthropic 发布", bodyMd: "" }, registry);
    expect(owners).toEqual([{ company: "anthropic" }]);
    expect("role" in owners[0]!).toBe(false);
  });
});

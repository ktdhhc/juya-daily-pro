// enrich TDD 测试（spec09 Step 2.1 / 2.3，ADR-0011 单测一律不调真实 LLM）
// 覆盖：buildEnrichPrompt 快照与 4000 字符截断边界、parseEnrichResponse 全分支、
// deriveRoles 三样本（对比提及干扰 / 双平台 / 多方联合，fixtures 取 D1 已入库真实判例）、
// enrich-sql 写库语句（转义 / COALESCE 在场）。与 src/lib/matchCompanies.test.ts 同层风格。
import { describe, expect, it } from "vitest";
import {
  buildEnrichPrompt,
  deriveRoles,
  parseEnrichResponse,
  type EnrichCandidate,
  type EnrichItem,
} from "./enrich";
import { enrichApplySql, enrichCacheUpsertSql } from "./enrich-sql";

// ---------- 真实判例 fixtures（D1 已入库；正文图片 markdown 行与断言无关，略） ----------

// 20260829-1 腾讯 Hy4：候选含月之暗面/智谱（盲测对比提及干扰）
const hy4Item: EnrichItem = {
  title: "腾讯发布并开源 Hy4 preview 模型",
  summary:
    "腾讯混元发布并开源 Hy4 preview，总参数 770B，激活参数 49B，上下文长度 1M。官方称其在软件工程、办公及科研等生产力任务上取得进展，内部盲测略优于 GLM-5.3 与 Kimi K3。模型已发布权重并上线API及相关应用，WorkBuddy 宣布限时免费至 2026 年 9 月 10 日，Hy3 免费延长至 9 月 30 日。",
  bodyMd:
    "腾讯正式发布并开源新一代旗舰模型 Hy4 preview。模型总参数 770B，每个 token 激活 49B 参数，上下文窗口达 1M。模型注意力模块采用 Gated DSA，残差路径使用 iHC，权重基于 Apache 2.0 协议开源。\n" +
    "官方表示 Hy4 preview 重点提升了软件工程、办公分析、游戏开发及科学研究等生产力场景能力。根据官方盲测数据，内部专家对多个工程任务的评估显示，Hy4 preview 略优于 GLM-5.3 和 Kimi K3。\n" +
    "Hy4 preview API 已上线腾讯云和 OpenRoute。模型已接入 WorkBuddy、CodeBuddy、元宝和 ima 等产品。WorkBuddy 宣布首发接入并限时免费至 2026 年 9 月 10 日，Hy3 免费延长至 9 月 30 日。",
};

// 20260829-6 ChatGPT 连接谷歌账号：Google / OpenAI 双平台
const multiPlatformItem: EnrichItem = {
  title: "ChatGPT 和 Codex 支持连接多个谷歌账号",
  summary:
    "ChatGPT 和 Codex 目前支持连接多个 Gmail 账号。该功能覆盖 Gmail、日历和联系人，但仅限付费订阅方案使用。",
  bodyMd:
    "ChatGPT 和 Codex 目前支持连接多个 Gmail 和 Google Cal 账号。用户可通过插件设置添加新账号，功能覆盖 Gmail、日历和联系人。该功能已在网页端、桌面端、iOS 和 Android 端上线，但仅限付费订阅方案使用。",
};

// 20260828-5 OpenAI 联合 Anthropic 等呼吁：4 家候选
const jointCallItem: EnrichItem = {
  title: "OpenAI 联合 Anthropic 等呼吁加强网络防御",
  summary:
    "OpenAI 联合 Anthropic 等公司呼吁加强网络防御，指出应对 AI 驱动网络攻击的窗口期有限。该倡议提出赋能防御者等原则及各方行动方向。",
  bodyMd:
    "OpenAI 联合 Anthropic、AWS、Google、Microsoft 和 Oracle 等公司共同发起加强网络防御的集体行动呼吁，指出应对 AI 驱动网络攻击的窗口期有限。该呼吁提出认识到现状安全不足、用具备网络能力的人工智能赋能防御者以及动员全球集体响应三大原则。OpenAI 官方发文详细列出了针对各类组织、网络安全公司、政府和前沿人工智能公司的具体行动建议。其中明确要求前沿人工智能公司确保 Agentic 身份可追溯且可问责，并向资源不足的关键基础设施防御者提供模型访问与资金支持。",
};

// 候选清单：evidence = 调用方对 title/body 按别名重扫得出的命中别名清单（matchCandidates 同款）
const hy4Candidates: EnrichCandidate[] = [
  { id: "tencent", name: "腾讯", notes: "混元 / WorkBuddy", evidence: ["腾讯", "Hy3", "WorkBuddy"] },
  { id: "moonshot", name: "月之暗面", notes: "Kimi 厂商", evidence: ["Kimi"] },
  { id: "zhipu", name: "智谱", notes: "GLM 厂商", evidence: ["GLM"] },
];
const multiPlatformCandidates: EnrichCandidate[] = [
  { id: "google", name: "Google", notes: "Gemini / DeepMind", evidence: ["Google"] },
  { id: "openai", name: "OpenAI", notes: "ChatGPT / GPT 厂商", evidence: ["ChatGPT", "Codex", "GPT"] },
];
const jointCallCandidates: EnrichCandidate[] = [
  { id: "anthropic", name: "Anthropic", notes: "Claude 厂商", evidence: ["Anthropic"] },
  { id: "google", name: "Google", notes: "Gemini / DeepMind", evidence: ["Google"] },
  { id: "microsoft", name: "Microsoft", notes: "Azure / Copilot", evidence: ["Microsoft"] },
  { id: "openai", name: "OpenAI", notes: "ChatGPT / GPT 厂商", evidence: ["OpenAI"] },
];

// ---------- buildEnrichPrompt ----------

describe("buildEnrichPrompt", () => {
  it("快照（腾讯 Hy4 样本）：system 含 JSON 约定，user 含标题/摘要/全文与候选 id", () => {
    const { system, user } = buildEnrichPrompt(hy4Item, hy4Candidates);
    expect(system).toContain("JSON");
    expect(user).toContain(hy4Item.title);
    expect(user).toContain(hy4Item.summary);
    expect(user).toContain(hy4Item.bodyMd); // 915 字符 < 4000 → 全文在场
    expect(user).toContain("tencent");
    expect(user).toContain("moonshot");
    expect(user).toContain("zhipu");
    expect(user).toContain("primary_company_id");
    expect(user).toContain("reason");
  });

  it("bodyMd 恰 4000 字符 → 不截断，全文在场", () => {
    const item: EnrichItem = { title: "t", summary: "s", bodyMd: "Y".repeat(4000) };
    const { user } = buildEnrichPrompt(item, hy4Candidates);
    expect(user).toContain("Y".repeat(4000));
  });

  it("bodyMd 4001 字符 → 截断到 4000，第 4001 字符起的尾巴不出现", () => {
    const item: EnrichItem = { title: "t", summary: "s", bodyMd: "X".repeat(4001) + "TAILMARK" };
    const { user } = buildEnrichPrompt(item, hy4Candidates);
    expect(user).toContain("X".repeat(4000));
    expect(user).not.toContain("X".repeat(4001));
    expect(user).not.toContain("TAILMARK");
  });
});

// ---------- parseEnrichResponse（candidateIds 取 20260829-6 候选）----------

describe("parseEnrichResponse", () => {
  const ids = ["google", "openai"];
  const okJson = '{"primary_company_id": "openai", "reason": "ChatGPT 与 Codex 均为 OpenAI 产品"}';

  it("裸 JSON 合法 → 返回 { primaryId, reason }", () => {
    expect(parseEnrichResponse(okJson, ids)).toEqual({
      primaryId: "openai",
      reason: "ChatGPT 与 Codex 均为 OpenAI 产品",
    });
  });

  it("```json 围栏包裹 → 剥围栏后解析", () => {
    expect(parseEnrichResponse("```json\n" + okJson + "\n```", ids)).toEqual({
      primaryId: "openai",
      reason: "ChatGPT 与 Codex 均为 OpenAI 产品",
    });
  });

  it("``` 无语言标记围栏 → 同样剥围栏解析", () => {
    expect(parseEnrichResponse("```\n" + okJson + "\n```", ids)?.primaryId).toBe("openai");
  });

  it("非法 JSON → null", () => {
    expect(parseEnrichResponse("{primary_company_id: openai}", ids)).toBeNull();
    expect(parseEnrichResponse("抱歉，我无法输出 JSON", ids)).toBeNull();
  });

  it("JSON 合法但不是对象（字符串/数组）→ null", () => {
    expect(parseEnrichResponse('"openai"', ids)).toBeNull();
    expect(parseEnrichResponse('["openai"]', ids)).toBeNull();
  });

  it("幻觉 id（不在 candidateIds）→ null", () => {
    expect(parseEnrichResponse('{"primary_company_id": "anthropic", "reason": "x"}', ids)).toBeNull();
  });

  it("缺 reason / 缺 primary_company_id → null", () => {
    expect(parseEnrichResponse('{"primary_company_id": "openai"}', ids)).toBeNull();
    expect(parseEnrichResponse('{"reason": "x"}', ids)).toBeNull();
  });

  it("reason 空串 / 纯空白 → null", () => {
    expect(parseEnrichResponse('{"primary_company_id": "openai", "reason": ""}', ids)).toBeNull();
    expect(parseEnrichResponse('{"primary_company_id": "openai", "reason": "  "}', ids)).toBeNull();
  });

  it("围栏残缺（无闭合 ```）→ null", () => {
    expect(parseEnrichResponse("```json\n" + okJson, ids)).toBeNull();
  });
});

// ---------- deriveRoles（三样本）----------

describe("deriveRoles", () => {
  it("对比提及干扰（20260829-1）：primary=tencent，月之暗面/智谱仅 body 命中 → subject", () => {
    const verdicts = deriveRoles(
      hy4Item,
      hy4Candidates,
      "tencent",
      "腾讯是 Hy4 的发布与开源方，月之暗面与智谱仅在盲测对比中被提及",
    );
    expect(verdicts).toStrictEqual([
      { companyId: "tencent", role: "primary", reason: "腾讯是 Hy4 的发布与开源方，月之暗面与智谱仅在盲测对比中被提及" },
      { companyId: "moonshot", role: "subject" },
      { companyId: "zhipu", role: "subject" },
    ]);
  });

  it("双平台（20260829-6）：primary=openai，Google 按真实命中仅 body（Google Cal）→ subject", () => {
    const verdicts = deriveRoles(
      multiPlatformItem,
      multiPlatformCandidates,
      "openai",
      "ChatGPT 与 Codex 是 OpenAI 产品，功能由 OpenAI 主导，Google 是被连接的平台",
    );
    expect(verdicts).toStrictEqual([
      { companyId: "openai", role: "primary", reason: "ChatGPT 与 Codex 是 OpenAI 产品，功能由 OpenAI 主导，Google 是被连接的平台" },
      { companyId: "google", role: "subject" }, // Google 未在 title 命中，仅 body
    ]);
  });

  it("命中位置标注优先：hitInTitle=true 的非 primary 候选 → partner（不经 evidence 重扫）", () => {
    const annotated: EnrichCandidate[] = [
      { id: "google", name: "Google", notes: "Gemini / DeepMind", evidence: ["Google"], hitInTitle: true, hitInBody: true },
    ];
    const verdicts = deriveRoles(multiPlatformItem, annotated, "openai", "r");
    expect(verdicts).toStrictEqual([{ companyId: "google", role: "partner" }]);
  });

  it("多方联合（20260828-5）：primary=openai，Anthropic title 命中 → partner，Google/Microsoft 仅 body → subject", () => {
    const verdicts = deriveRoles(jointCallItem, jointCallCandidates, "openai", "OpenAI 发起并牵头该联合呼吁");
    expect(verdicts).toStrictEqual([
      { companyId: "openai", role: "primary", reason: "OpenAI 发起并牵头该联合呼吁" },
      { companyId: "anthropic", role: "partner" },
      { companyId: "google", role: "subject" },
      { companyId: "microsoft", role: "subject" },
    ]);
  });
});

// ---------- enrich-sql（写库语句生成）----------

describe("enrichCacheUpsertSql", () => {
  it("形态：INSERT INTO enrich_cache + ON CONFLICT(item_id) 更新 result/llm_model，单语句 ; 收尾", () => {
    const sql = enrichCacheUpsertSql(
      "20260829-1",
      '[{"companyId":"tencent","role":"primary","reason":"r"}]',
      "test-model",
    );
    expect(sql).toContain("INSERT INTO enrich_cache (item_id, result, llm_model) VALUES ");
    expect(sql).toContain("ON CONFLICT(item_id) DO UPDATE SET result = excluded.result, llm_model = excluded.llm_model;");
    expect(sql.endsWith(";")).toBe(true);
    expect(sql.slice(0, -1)).not.toContain(";");
    expect(sql).not.toContain("\n");
  });

  it("单引号翻倍转义：itemId / result JSON / llm_model", () => {
    const sql = enrichCacheUpsertSql("it'1", '{"reason":"it\'s ok"}', "m'1");
    expect(sql).toContain("'it''1'");
    expect(sql).toContain("it''s ok");
    expect(sql).toContain("'m''1'");
  });
});

describe("enrichApplySql", () => {
  it("两条语句：enrich_cache upsert + item_companies role 回写（COALESCE 在场），各单行 ; 收尾", () => {
    const verdicts = [
      { companyId: "tencent", role: "primary" as const, reason: "主导方" },
      { companyId: "moonshot", role: "subject" as const },
    ];
    const sql = enrichApplySql("20260829-1", verdicts, "test-model");
    const lines = sql.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("INSERT INTO enrich_cache");
    expect(lines[0]).toContain("主导方");
    expect(lines[1]).toContain("INSERT INTO item_companies (item_id, company_id, role)");
    expect(lines[1]).toContain("COALESCE(excluded.role, item_companies.role)");
    expect(lines[1]).toContain("'tencent', 'primary'");
    expect(lines[1]).toContain("'moonshot', 'subject'");
    for (const line of lines) expect(line.endsWith(";")).toBe(true);
  });
});

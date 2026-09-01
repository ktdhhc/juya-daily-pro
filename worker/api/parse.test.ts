// parse 纯函数测试（spec10 Step 2.3，TDD 先红后绿）。
// 覆盖：圈题分支（多家 / 单家 / 已有 proposal / missing_owner / 非 missing 零归属）、
// SQL 生成（转义 + 幂等子句 + ON CONFLICT 冲突策略）、patch body 校验（含 primary ≤1）、
// assemblePending 组装（日期升序 / owners / proposal / candidate）、publish 语句组。
// LLM 编排与 D1 读写为薄 IO，不单测（ADR-0011），以 wrangler dev + curl 验收。
import { describe, expect, it } from "vitest";
import {
  applyProposalStatements,
  assemblePending,
  buildPublishedMissingRolesQuery,
  patchStatements,
  proposalUpsertSql,
  proposeInsertSql,
  publishDateStatements,
  selectParseTargets,
  validatePatchBody,
  type OwnerCompanyInput,
  type PendingCandidateRow,
  type PendingItemRow,
  type PendingOwnerRow,
  type PendingProposalRow,
  type StagedItemInput,
} from "./parse";

// ---------- selectParseTargets ----------

function item(partial: Partial<StagedItemInput> & { id: string }): StagedItemInput {
  return {
    title: "默认标题",
    summary: "默认摘要",
    bodyMd: "默认正文",
    enrichState: "ok",
    ...partial,
  };
}

const OWNER_OPENAI: OwnerCompanyInput = {
  itemId: "20260829-1",
  companyId: "openai",
  name: "OpenAI",
  notes: "ChatGPT 母公司",
  aliases: ["OpenAI"],
};
const OWNER_ANTHROPIC: OwnerCompanyInput = {
  itemId: "20260829-1",
  companyId: "anthropic",
  name: "Anthropic",
  notes: "Claude 母公司",
  aliases: ["Anthropic"],
};

describe("selectParseTargets", () => {
  it("多家命中（≥2）且无 proposal → enrichTargets，candidates 携带 evidence 与 hitInTitle", () => {
    const items = [
      item({
        id: "20260829-1",
        title: "OpenAI 发布新模型",
        bodyMd: "Anthropic 亦更新，正文再提 openai 一次",
        enrichState: "ok",
      }),
    ];
    const targets = selectParseTargets(items, [OWNER_OPENAI, OWNER_ANTHROPIC], new Set());
    expect(targets.enrichTargets).toHaveLength(1);
    expect(targets.enrichTargets[0]?.itemId).toBe("20260829-1");
    const candidates = targets.enrichTargets[0]?.candidates ?? [];
    expect(candidates.map((c) => c.id)).toEqual(["openai", "anthropic"]);
    const openai = candidates[0];
    expect(openai?.name).toBe("OpenAI");
    expect(openai?.notes).toBe("ChatGPT 母公司");
    expect(openai?.evidence.length).toBeGreaterThan(0);
    expect(openai?.hitInTitle).toBe(true); // 标题命中
    expect(candidates[1]?.hitInTitle).toBe(false); // Anthropic 仅正文命中，标题无别名
  });

  it("单家命中 → 不进 enrichTargets 也不进 missingTargets", () => {
    const items = [item({ id: "20260829-2", enrichState: "ok" })];
    const targets = selectParseTargets(
      items,
      [{ ...OWNER_OPENAI, itemId: "20260829-2" }],
      new Set(),
    );
    expect(targets.enrichTargets).toHaveLength(0);
    expect(targets.missingTargets).toHaveLength(0);
  });

  it("多家命中但已有 proposal → 幂等跳过", () => {
    const items = [item({ id: "20260829-1", enrichState: "ok" })];
    const targets = selectParseTargets(
      items,
      [OWNER_OPENAI, OWNER_ANTHROPIC],
      new Set(["20260829-1"]),
    );
    expect(targets.enrichTargets).toHaveLength(0);
    expect(targets.missingTargets).toHaveLength(0);
  });

  it("enrich_state='missing_owner' → missingTargets 携带 title/summary/bodyMd", () => {
    const items = [
      item({
        id: "20260829-3",
        title: "某新公司融资",
        summary: "一家新公司",
        bodyMd: "正文内容",
        enrichState: "missing_owner",
      }),
    ];
    const targets = selectParseTargets(items, [], new Set());
    expect(targets.missingTargets).toEqual([
      { itemId: "20260829-3", title: "某新公司融资", summary: "一家新公司", bodyMd: "正文内容" },
    ]);
    expect(targets.enrichTargets).toHaveLength(0);
  });

  it("missing_owner 但已有 proposal → 跳过（proposal 判定优先）", () => {
    const items = [item({ id: "20260829-3", enrichState: "missing_owner" })];
    const targets = selectParseTargets(items, [], new Set(["20260829-3"]));
    expect(targets.missingTargets).toHaveLength(0);
    expect(targets.enrichTargets).toHaveLength(0);
  });

  it("非 missing 的零归属（enrich_state='pending'）→ 两边都不进", () => {
    const items = [item({ id: "20260829-4", enrichState: "pending" })];
    const targets = selectParseTargets(items, [], new Set());
    expect(targets.enrichTargets).toHaveLength(0);
    expect(targets.missingTargets).toHaveLength(0);
  });

  it("多条目混批：targets 顺序与 items 输入顺序一致", () => {
    const items = [
      item({ id: "20260829-9", enrichState: "missing_owner" }),
      item({ id: "20260829-1", enrichState: "ok" }), // 多家
      item({ id: "20260829-2", enrichState: "ok" }), // 单家
    ];
    const owners: OwnerCompanyInput[] = [OWNER_OPENAI, OWNER_ANTHROPIC];
    const targets = selectParseTargets(items, owners, new Set());
    expect(targets.missingTargets.map((m) => m.itemId)).toEqual(["20260829-9"]);
    expect(targets.enrichTargets.map((t) => t.itemId)).toEqual(["20260829-1"]);
  });
});

// ---------- SQL 生成 ----------

describe("proposeInsertSql", () => {
  it("单行 INSERT：含 ON CONFLICT(id) DO NOTHING（已有同名建议不覆盖）与 aliases JSON", () => {
    const sql = proposeInsertSql([
      {
        id: "mistral-ai",
        name: "Mistral AI",
        aliases: ["Mistral", "Le Chat"],
        confidence: "high",
        reason: "法国 AI 公司",
        sourceItemId: "20260829-3",
      },
    ]);
    expect(sql).toContain("INSERT INTO company_candidates");
    expect(sql).toContain("(id, name, aliases, confidence, reason, source_item_id)");
    expect(sql).toContain("ON CONFLICT(id) DO NOTHING;");
    expect(sql).toContain(`'["Mistral","Le Chat"]'`);
    expect(sql).toContain("'mistral-ai'");
    expect(sql).toContain("'20260829-3'");
    expect(sql.endsWith(";")).toBe(true);
    expect(sql).not.toContain("status"); // status 走表默认 'pending'
  });

  it("文本转义：单引号翻倍；多行 VALUES 逗号分隔", () => {
    const sql = proposeInsertSql([
      { id: "a", name: "O'Company", aliases: [], confidence: "low", reason: "一'句话", sourceItemId: "x" },
      { id: "b", name: "B", aliases: ["bee"], confidence: "mid", reason: "理由", sourceItemId: "y" },
    ]);
    expect(sql).toContain("'O''Company'");
    expect(sql).toContain("'一''句话'");
    expect(sql).toContain("), (");
  });

  it("空数组 → 空串（不产生语句）", () => {
    expect(proposeInsertSql([])).toBe("");
  });
});

describe("proposalUpsertSql", () => {
  it("单行 upsert：owners 为 JSON 字面量，冲突更新 owners/llm_model", () => {
    const sql = proposalUpsertSql([
      {
        itemId: "20260829-1",
        owners: [
          { companyId: "openai", role: "primary" },
          { companyId: "anthropic", role: "partner" },
        ],
        llmModel: "test-model",
      },
    ]);
    expect(sql).toContain("INSERT INTO item_proposals (item_id, owners, llm_model)");
    expect(sql).toContain(`'[{"companyId":"openai","role":"primary"},{"companyId":"anthropic","role":"partner"}]'`);
    expect(sql).toContain("'test-model'");
    expect(sql).toContain(
      "ON CONFLICT(item_id) DO UPDATE SET owners = excluded.owners, llm_model = excluded.llm_model;",
    );
  });

  it("多行 VALUES；itemId/llmModel 单引号转义", () => {
    const sql = proposalUpsertSql([
      { itemId: "a'1", owners: [{ companyId: "c", role: "subject" }], llmModel: "m" },
      { itemId: "b", owners: [{ companyId: "c2", role: "primary" }], llmModel: "m'2" },
    ]);
    expect(sql).toContain("'a''1'");
    expect(sql).toContain("'m''2'");
    expect(sql).toContain("), (");
  });

  it("空数组 → 空串", () => {
    expect(proposalUpsertSql([])).toBe("");
  });
});

// ---------- validatePatchBody ----------

describe("validatePatchBody", () => {
  it("合法 body（1 primary + partner）→ ok:true 且 owners 原样归一", () => {
    const v = validatePatchBody({
      itemId: "20260829-1",
      owners: [
        { companyId: "openai", role: "primary" },
        { companyId: "anthropic", role: "partner" },
      ],
    });
    expect(v).toEqual({
      ok: true,
      itemId: "20260829-1",
      owners: [
        { companyId: "openai", role: "primary" },
        { companyId: "anthropic", role: "partner" },
      ],
    });
  });

  it("零 primary（全 partner/subject）→ ok:true（约束为 ≤1）", () => {
    const v = validatePatchBody({
      itemId: "x",
      owners: [
        { companyId: "a", role: "partner" },
        { companyId: "b", role: "subject" },
      ],
    });
    expect(v.ok).toBe(true);
  });

  it("owners 空数组 → ok:false", () => {
    expect(validatePatchBody({ itemId: "x", owners: [] }).ok).toBe(false);
  });

  it("owners 缺失 / 非数组 → ok:false", () => {
    expect(validatePatchBody({ itemId: "x" }).ok).toBe(false);
    expect(validatePatchBody({ itemId: "x", owners: "openai" }).ok).toBe(false);
  });

  it("role 非法 → ok:false", () => {
    expect(validatePatchBody({ itemId: "x", owners: [{ companyId: "a", role: "owner" }] }).ok).toBe(false);
  });

  it("两个 primary → ok:false（primary ≤1 约束）", () => {
    const v = validatePatchBody({
      itemId: "x",
      owners: [
        { companyId: "a", role: "primary" },
        { companyId: "b", role: "primary" },
      ],
    });
    expect(v.ok).toBe(false);
  });

  it("itemId 缺失 / 空串 / body 非对象 → ok:false", () => {
    expect(validatePatchBody({ owners: [{ companyId: "a", role: "primary" }] }).ok).toBe(false);
    expect(validatePatchBody({ itemId: "  ", owners: [{ companyId: "a", role: "primary" }] }).ok).toBe(false);
    expect(validatePatchBody(null).ok).toBe(false);
    expect(validatePatchBody([1]).ok).toBe(false);
  });

  it("owner 元素缺 companyId / companyId 空串 → ok:false", () => {
    expect(validatePatchBody({ itemId: "x", owners: [{ role: "primary" }] }).ok).toBe(false);
    expect(validatePatchBody({ itemId: "x", owners: [{ companyId: "", role: "primary" }] }).ok).toBe(false);
  });
});

// ---------- assemblePending ----------

const PENDING_ITEMS: PendingItemRow[] = [
  { id: "20260829-2", date: "2026-08-29", tag: "#2", category: "模型", title: "条目二", summary: "摘要二" },
  { id: "20260828-1", date: "2026-08-28", tag: "#1", category: "要闻", title: "条目一", summary: "摘要一" },
];
const PENDING_OWNERS: PendingOwnerRow[] = [
  { itemId: "20260829-2", companyId: "openai", name: "OpenAI", color: "#111111", role: null },
  { itemId: "20260828-1", companyId: "anthropic", name: "Anthropic", color: "#222222", role: "primary" },
];
const PENDING_PROPOSALS: PendingProposalRow[] = [
  {
    itemId: "20260829-2",
    owners: '[{"companyId":"openai","role":"primary"}]',
    llmModel: "test-model",
  },
];
const PENDING_CANDIDATES: PendingCandidateRow[] = [
  {
    id: "new-co",
    name: "NewCo",
    aliases: '["NewCo AI"]',
    confidence: "high",
    reason: "新公司",
    sourceItemId: "20260829-2",
  },
  {
    id: "other-co",
    name: "OtherCo",
    aliases: "[]",
    confidence: "low",
    reason: "另一个",
    sourceItemId: "20260827-9", // 不在暂存条目里
  },
];

describe("assemblePending", () => {
  it("日期升序分组 + 条目字段归位", () => {
    const payload = assemblePending(PENDING_ITEMS, PENDING_OWNERS, PENDING_PROPOSALS, PENDING_CANDIDATES);
    expect(payload.dates.map((d) => d.date)).toEqual(["2026-08-28", "2026-08-29"]);
    expect(payload.dates[1]?.items[0]?.id).toBe("20260829-2");
    expect(payload.dates[1]?.items[0]?.tag).toBe("#2");
    expect(payload.dates[1]?.items[0]?.category).toBe("模型");
  });

  it("owners 映射 name/color/role（NULL → null）", () => {
    const payload = assemblePending(PENDING_ITEMS, PENDING_OWNERS, PENDING_PROPOSALS, PENDING_CANDIDATES);
    expect(payload.dates[0]?.items[0]?.owners).toEqual([
      { companyId: "anthropic", name: "Anthropic", color: "#222222", role: "primary" },
    ]);
    expect(payload.dates[1]?.items[0]?.owners).toEqual([
      { companyId: "openai", name: "OpenAI", color: "#111111", role: null },
    ]);
  });

  it("proposal 解析（owners JSON + llmModel）；无 proposal → null", () => {
    const payload = assemblePending(PENDING_ITEMS, PENDING_OWNERS, PENDING_PROPOSALS, PENDING_CANDIDATES);
    expect(payload.dates[1]?.items[0]?.proposal).toEqual({
      owners: [{ companyId: "openai", role: "primary" }],
      llmModel: "test-model",
    });
    expect(payload.dates[0]?.items[0]?.proposal).toBeNull();
  });

  it("proposal JSON 损坏 → 容忍为 null（不抛）", () => {
    const broken: PendingProposalRow[] = [{ itemId: "20260829-2", owners: "{oops", llmModel: "m" }];
    const payload = assemblePending(PENDING_ITEMS, PENDING_OWNERS, broken, PENDING_CANDIDATES);
    expect(payload.dates[1]?.items[0]?.proposal).toBeNull();
  });

  it("candidate 按 source_item_id 归条目（aliases 解析 JSON）；无候选 → null；顶层 candidates 全量", () => {
    const payload = assemblePending(PENDING_ITEMS, PENDING_OWNERS, PENDING_PROPOSALS, PENDING_CANDIDATES);
    expect(payload.dates[1]?.items[0]?.candidate).toEqual({
      id: "new-co",
      name: "NewCo",
      aliases: ["NewCo AI"],
      confidence: "high",
      reason: "新公司",
    });
    expect(payload.dates[0]?.items[0]?.candidate).toBeNull();
    expect(payload.candidates).toHaveLength(2);
    expect(payload.candidates[1]).toEqual({
      id: "other-co",
      name: "OtherCo",
      aliases: [],
      confidence: "low",
      reason: "另一个",
      sourceItemId: "20260827-9",
    });
  });
});

// ---------- publish 语句组 ----------

describe("publishDateStatements", () => {
  it("sources 与 items 两条 UPDATE ... IN，日期字面量", () => {
    const stmts = publishDateStatements(["2026-08-29", "2026-08-28"]);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toContain("UPDATE sources SET published = 1 WHERE date IN ('2026-08-29', '2026-08-28');");
    expect(stmts[1]).toContain("UPDATE items SET published = 1 WHERE date IN ('2026-08-29', '2026-08-28');");
  });

  it("空日期 → 空语句组", () => {
    expect(publishDateStatements([])).toEqual([]);
  });
});

describe("applyProposalStatements", () => {
  it("单条 proposal 条目四语句：DELETE + 重插（带 role）+ enrich_state='ok' + enrich_cache", () => {
    const stmts = applyProposalStatements(
      "20260829-1",
      [
        { companyId: "openai", role: "primary" },
        { companyId: "anthropic", role: "partner" },
      ],
      "test-model",
    );
    expect(stmts).toHaveLength(4);
    expect(stmts[0]).toBe("DELETE FROM item_companies WHERE item_id = '20260829-1';");
    expect(stmts[1]).toContain("INSERT INTO item_companies (item_id, company_id, role)");
    expect(stmts[1]).toContain("'primary'");
    expect(stmts[1]).toContain("'partner'");
    expect(stmts[2]).toBe("UPDATE items SET enrich_state = 'ok' WHERE id = '20260829-1';");
    expect(stmts[3]).toContain("INSERT INTO enrich_cache (item_id, result, llm_model)");
    expect(stmts[3]).toContain('\'[{"companyId":"openai","role":"primary"},{"companyId":"anthropic","role":"partner"}]\'');
    // SQL 纪律：每条单语句单行、`;` 结尾
    for (const s of stmts) {
      expect(s.endsWith(";")).toBe(true);
      expect(s.includes("\n")).toBe(false);
    }
  });
});

describe("patchStatements", () => {
  it("四语句：DELETE + 重插（带 role）+ enrich_state='ok' + proposal 同步（human-edit）", () => {
    const stmts = patchStatements("20260829-1", [
      { companyId: "tencent", role: "primary" },
      { companyId: "moonshot", role: "partner" },
    ]);
    expect(stmts).toHaveLength(4);
    expect(stmts[0]).toBe("DELETE FROM item_companies WHERE item_id = '20260829-1';");
    expect(stmts[1]).toContain("'tencent'");
    expect(stmts[1]).toContain("'partner'");
    expect(stmts[2]).toBe("UPDATE items SET enrich_state = 'ok' WHERE id = '20260829-1';");
    // 人工编辑同步回 proposal：publish 重放 proposal 即重放人工终版（review P1 修复）
    expect(stmts[3]).toContain("INSERT INTO item_proposals (item_id, owners, llm_model)");
    expect(stmts[3]).toContain("'human-edit'");
    expect(stmts[3]).toContain(
      '\'[{"companyId":"tencent","role":"primary"},{"companyId":"moonshot","role":"partner"}]\'',
    );
    for (const s of stmts) {
      expect(s.endsWith(";")).toBe(true);
      expect(s.includes("\n")).toBe(false);
    }
  });
});

// ---------- selectParseTargets 已发布补救类合并（spec11 契约 B） ----------

describe("selectParseTargets 已发布补救类合并", () => {
  const OWNERS_830 = [
    { ...OWNER_OPENAI, itemId: "20260830-1" },
    { ...OWNER_ANTHROPIC, itemId: "20260830-1" },
  ];

  it("已发布多家命中条目经第二类输入并入 enrichTargets", () => {
    const targets = selectParseTargets(
      [],
      OWNERS_830,
      new Set(),
      [item({ id: "20260830-1", title: "OpenAI 宣布与 Anthropic 合作终止", enrichState: "ok" })],
    );
    expect(targets.enrichTargets).toHaveLength(1);
    expect(targets.enrichTargets[0]?.itemId).toBe("20260830-1");
    expect(targets.enrichTargets[0]?.candidates.map((c) => c.id)).toEqual(["openai", "anthropic"]);
  });

  it("暂存类优先去重：同 id 两类并存时只算一份", () => {
    const targets = selectParseTargets(
      [item({ id: "20260830-1", title: "暂存版标题", enrichState: "ok" })],
      OWNERS_830,
      new Set(),
      [item({ id: "20260830-1", title: "已发布版标题", enrichState: "ok" })],
    );
    expect(targets.enrichTargets).toHaveLength(1);
    expect(targets.enrichTargets[0]?.itemId).toBe("20260830-1");
  });

  it("已发布类不受 proposal 跳过约束（历史 proposal + role NULL = 待补救形态，实测 20260829-6）", () => {
    const targets = selectParseTargets(
      [],
      OWNERS_830,
      new Set(["20260830-1"]),
      [item({ id: "20260830-1", enrichState: "ok" })],
    );
    expect(targets.enrichTargets).toHaveLength(1);
    expect(targets.enrichTargets[0]?.itemId).toBe("20260830-1");
  });

  it("buildPublishedMissingRolesQuery：published=1 + 无 enrich_cache + 多家命中 + role 含 NULL（不排除有 proposal 的待补救条目）", () => {
    const q = buildPublishedMissingRolesQuery();
    expect(q.sql).toContain("published = 1");
    expect(q.sql).toContain("NOT EXISTS");
    expect(q.sql).toContain("enrich_cache");
    expect(q.sql).not.toContain("item_proposals");
    expect(q.sql).toContain("role IS NULL");
    expect(q.sql).toContain(">= 2");
    expect(q.params).toEqual([]);
  });
});

// ---------- 缺公司候选跳过闸门（spec12 走查发现：已提议候选的 missing_owner 不再重调 LLM） ----------

describe("selectParseTargets 候选已提议跳过", () => {
  it("missing_owner 且 company_candidates 已有该条目提议 → 不进 missingTargets", () => {
    const targets = selectParseTargets(
      [item({ id: "20260901-5", enrichState: "missing_owner" })],
      [],
      new Set(),
      [],
      new Set(["20260901-5"]),
    );
    expect(targets.missingTargets).toHaveLength(0);
    expect(targets.enrichTargets).toHaveLength(0);
  });

  it("未提议的 missing_owner 照常进 missingTargets", () => {
    const targets = selectParseTargets(
      [item({ id: "20260901-5", enrichState: "missing_owner" })],
      [],
      new Set(),
      [],
      new Set(["20260831-1"]),
    );
    expect(targets.missingTargets).toHaveLength(1);
    expect(targets.missingTargets[0]?.itemId).toBe("20260901-5");
  });
});

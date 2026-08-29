# Spec 09 · LLM 数据整理（工程性，线性执行）

> 来源：2026-08-29 用户需求——结合 LLM 的数据整理能力。上游：ADR-0009（LLM 任务收窄：只判 primary，启发式补 partner/subject）、ADR-0001（companies-pending 候选流程，人工入册）、ADR-0014（LLM 移出同步关键路径，离线批跑）。
> 两个离线作业：**enrich 归属裁决** 与 **候选公司提议**，共用同一套 LLM 接入层。本文可按顺序逐步执行。**全程零 Cloudflare 登录；LLM 调用仅发生在真实运行时（单测不调真实 LLM，ADR-0011）。**

## 目标

1. **enrich 回填**：对全部多家命中条目（≥2 家），LLM 单选题判主导，启发式补其余角色，写 `enrich_cache` 与 `item_companies.role`——徽章从此分主次。
2. **候选公司提议**：对全部零归属条目（128 条），LLM 按"活跃科技/AI 公司 / 已知公司产品 / 无关实体"三分类判别，新公司信号输出到 `data/companies-pending.yaml` 供人工入册——白名单的自我修复通道。

## 前置事实（已核验）

- 选择集：多家命中 323 条（item_companies 计数 ≥2）；零归属 128 条（enrich_state='missing_owner'）。
- `enrich_cache` 表：`item_id PK / result TEXT NOT NULL（JSON: [{companyId, role, reason}]）/ llm_model / created_at`——**result 存"最终裁决数组"**（LLM 挑 primary + 启发式合成后的完整答案，reason 挂在 primary 上），重跑直接应用、人工纠错只改一处（与建表注释一致；ADR-0009 的 `{primary_company_id, reason}` 为中间产物，不入库）。
- `.env` 键名与 wrangler vars 不一致：`.env` 为 `LLM_BASE_URL / MODEL_NAME / LLM_API_KEY`，wrangler vars 为 `LLM_API_BASE / LLM_MODEL`——接入层做显式映射，两边都认，`.env` 优先。
- `MAX_LLM_PER_RUN`（wrangler vars，默认 20）= 单次运行 LLM 调用上限；`itemCompaniesUpsertSql` 现仅写 role=NULL，需扩展。
- 真实判例（已入库，作测试语料）：`20260829-1`「腾讯发布并开源 Hy4 preview」候选含月之暗面/智谱（对比提及干扰）；`20260829-6`「ChatGPT 和 Codex 支持连接多个谷歌账号」候选 Google/OpenAI；`20260828-5`「OpenAI 联合 Anthropic 等呼吁」4 家候选。

## 执行步骤（线性）

### Step 1 — LLM 接入层（纯函数 + 薄 IO）

1.1 `scripts/lib/llm.ts`：
  - `loadLlmConfig()`：读 `.env`（简单键值解析，不引依赖）→ `LLM_BASE_URL / MODEL_NAME / LLM_API_KEY`；缺失回退 wrangler.jsonc vars `LLM_API_BASE / LLM_MODEL`（key 无回退，缺 key 报错退出）；
  - `chatJson(cfg, system, user): Promise<unknown>`：POST `<base>/chat/completions`（response_format json_object），429/5xx 退避重试 1 次；返回消息内容字符串；
  - `runWithLimiter(jobs, max)`：每轮上限执行器。
1.2 校验：`npm run sync` 等既有脚本不受影响；缺 key 时 `npm run enrich` 报错退出（信息含"检查 .env"）。

### Step 2 — enrich 作业（先红后绿：纯函数全测，IO 薄胶水）

2.1 `scripts/llm/enrich-prompt.ts` 纯函数：
  - `buildEnrichPrompt(item, candidates)`：系统提示=中文 AI 行业编辑、只输出 JSON；用户材料=标题/摘要/正文（**4000 字符截断**）+ 候选清单（id/name/notes/命中别名证据）；问题=从候选中选一个主导公司，输出 `{"primary_company_id": "...", "reason": "..."}`；
  - `parseEnrichResponse(raw, candidateIds)`：剥 ```json 围栏 → JSON.parse → 校验 primary ∈ candidateIds → 返回 `{primaryId, reason}`，任何不合法返回 null；
  - `deriveRoles(item, candidates, primaryId)`：其余候选 title 命中 → `partner`；仅 body 命中 → `subject`；产出 `[{companyId, role, reason}]`（reason 仅 primary）。
2.2 vitest（真实语料当 fixture）：prompt 快照（腾讯 Hy4 样本）+ 截断边界；parse 全分支（合法/围栏/非法 JSON/幻觉 id/缺字段）；deriveRoles 三样本（对比提及干扰/平台连接/多方联合）。
2.3 `scripts/enrich.ts`（`npm run enrich`）：读 D1 → 圈多家命中条目（升序）→ 跳过已有 cache（`--force` 重算）→ 限流执行 → 合格者写 `enrich_cache`（result=裁决数组 JSON + llm_model）+ 回写 role（`itemCompaniesUpsertSql` 扩展接受 role，同步修正 spec03 既有用例的 NULL 断言）→ 报告（成功/跳过/失败清单 + role 分布）。
2.4 **真实抽验**：`npm run enrich -- --limit=3`（真实 LLM，唯一一次默认验证），人工读 3 条 reason 合理性；SQL 核验 primary 100% ∈ 候选集。

### Step 3 — 候选公司提议作业

3.1 `scripts/llm/propose-prompt.ts` 纯函数：`buildProposePrompt(item, registryNames)`——三分类判别：①活跃科技/AI 公司（未在册 → 建议入册：`{kind:"company", id 建议, name, aliases 建议, evidence}`）②已入册公司的产品/子品牌（`{kind:"product", parent, evidence}` → 若 parent 在册则仅记录，提示可加 alias）③无关实体（`{kind:"ignore"}`）；输出仅 JSON。
3.2 vitest：三分类用例 + 幻觉 parent 不在册处理 + parse 分支（红→绿）。
3.3 `scripts/propose-companies.ts`（`npm run propose:companies`）：读 missing_owner 条目（`--limit` 默认 40/轮）→ 逐条判别 → **不直接入册**：合并（按建议 id 去重）追加写 `data/companies-pending.yaml`（CompanyCandidate 形态：id/name/aliases/confidence/reason/source=item id）→ 报告（company/product/ignore 分布 + 建议清单）。
3.4 人工流程（一次性演示）：review pending 文件 → 认可的搬进 `companies.yaml` → `gen:registry` → `sync` + `match:all` → missing_owner 下降。**LLM 永不直接改白名单**。

### Step 4 — 验证与文档

- 全部纯函数单测红→绿（预估 ≥14 用例）；四门禁绿。
- `enrich_cache` 人工纠错演练：改一条 result → `--force` 单条重应用 → role 按人工答案生效。
- 抽验报告与分布统计入 `.scratch/spec09-llm-curation/`。

## 验收清单

- [ ] 纯函数单测全绿（prompt 快照/parse 分支/deriveRoles/propose 三分类/配置映射）
- [ ] `npm run enrich -- --limit=3` 真实跑通，reason 人工可读，primary 全部 ∈ 候选
- [ ] 全量跑（分轮）后：multi 命中条目 role 覆盖率 ≥95%（失败清单说明余量）；徽章渲染主次
- [ ] `npm run propose:companies` 产出 pending 文件，每条带 source 可溯源；白名单未被自动修改
- [ ] 人工纠错演练通过；四门禁绿

## 边界

- 不进同步关键路径：sync/同步按钮永远零 LLM（ADR-0014）；定期批跑节奏部署日再定。
- 不自动入册、不生成公司简介、不做话题聚类（Phase 2/远期）。
- 真实 LLM 调用属高成本验证：仅 Step 2.4 与全量跑两次，其余全靠单测。

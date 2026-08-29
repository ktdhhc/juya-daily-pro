# 02 · enrich 作业：LLM 主导裁决 + 启发式角色 + role 回写（存量回填）

Status: ready-for-agent

> 2026-08-29 修订：本票定位为**存量数据回填**（对已入库历史数据离线批跑）；新增数据走 spec10 编辑工作流。纯函数位置改为 `src/lib/llm/enrich.ts`（Worker 解析段将复用，见 spec10）。

## What to build

按 `docs/spec/spec09-llm-curation.md` Step 2（2.1→2.4）执行。前置：`scripts/lib/llm.ts` 已交付（`loadLlmConfig` / `chatJson` / `runWithLimiter`）。

### 2.1 纯函数（先红后绿）

`src/lib/llm/enrich.ts`：

- `buildEnrichPrompt(item: { title: string; summary: string; bodyMd: string }, candidates: EnrichCandidate[]): { system: string; user: string }`
  - `EnrichCandidate = { id: string; name: string; notes: string; evidence: string[] }`（evidence = 命中别名清单）。
  - 系统提示：中文 AI 行业编辑视角、只输出 JSON、禁止解释。
  - 用户材料：标题/摘要/正文（**bodyMd 超过 4000 字符截断到 4000**）+ 候选清单（id/name/notes/命中证据）。
  - 问题：从候选中选**一个主导公司**，输出 `{"primary_company_id": "...", "reason": "..."}`。
- `parseEnrichResponse(raw: string, candidateIds: string[]): { primaryId: string; reason: string } | null`
  - 剥 ```json 围栏（可有可无）→ JSON.parse → primary ∈ candidateIds 且 reason 为非空字符串 → 返回；任何不合法（非法 JSON / 幻觉 id / 缺字段 / 围栏残缺）→ null。
- `deriveRoles(item, candidates, primaryId): { companyId: string; role: "primary"|"partner"|"subject"; reason?: string }[]`
  - 其余候选：title 命中（candidates 增加命中位置标注，如 `hitInTitle: boolean`，由调用方从别名命中信息得出）→ `partner`；仅 body 命中 → `subject`。产出数组含 primary（role=primary，reason=裁决 reason）。

**TDD**（你没有 skill，按此手工执行）：`src/lib/llm/enrich.test.ts`，fixtures 用 spec 前置事实中的真实判例（`20260829-1` 腾讯 Hy4：候选含月之暗面/智谱干扰；`20260829-6` ChatGPT 连接谷歌账号：Google/OpenAI；`20260828-5` OpenAI 联合 Anthropic：4 家候选）。用例：
1. prompt 快照（腾讯 Hy4 样本：system 含「JSON」、user 含截断后正文与候选 id）
2. bodyMd 恰 4000 / 4001 字符截断边界
3. parse 全分支：裸 JSON / 围栏包裹 / 非法 JSON / 幻觉 id / 缺 reason / reason 空串
4. deriveRoles 三样本：对比提及干扰（月之暗面 body 命中 → subject）/ 双平台（Google title 命中 → partner，primary=OpenAI）/ 多方联合（其余按 title/body 分档）
先写测试跑红→实现→跑绿，贴证据。注意：**测试放 `src/lib/llm/enrich.test.ts`，与既有 `src/lib/matchCompanies.test.ts` 同层风格。**

### 2.2 SQL 扩展（先红后绿）

`worker/sync/sqlgen.ts` 的 `itemCompaniesUpsertSql(rows)`：行类型从 `{ itemId, companyId }` 扩展为 `{ itemId, companyId, role?: "primary"|"partner"|"subject"|null }`。upsert 的 DO UPDATE SET 增加 `role = COALESCE(excluded.role, item_companies.role)`——**防清摆**：同步路径传 role 缺省（NULL）不得清掉 enrich 已写的 role。NULL 字面量进 VALUES（现有 `primaryLink === undefined → "NULL"` 同款手法）。`worker/sync/sqlgen.test.ts`：spec03 既有 NULL 断言改为 COALESCE 语义断言（含：插入 NULL role / 更新时旧 role 保留 / 新 role 覆盖旧 role 三条）。先红后绿。

### 2.3 `scripts/enrich.ts`（`npm run enrich`，package.json 加 script 一行）

流程：loadLlmConfig → wrangler-cli 读 D1：圈**多家命中条目**（`SELECT item_id, COUNT(*) c FROM item_companies GROUP BY item_id HAVING c >= 2`）按 item_id 升序 + 各条目 title/body_md + 候选（item_companies ⋈ companies，命中别名证据从 title/body 对 aliases 重扫得出）→ 跳过已有 enrich_cache 条目（`--force` 重算）→ `MAX_LLM_PER_RUN`（wrangler.jsonc vars，默认 20，`--max=` 覆盖）限流 → 合格者写库（wrangler d1 execute --local，SQL 纪律：单语句单行、`;` 结尾、escapeSqlText 转义）：enrich_cache upsert（result=裁决数组 JSON、llm_model）+ item_companies role 回写（COALESCE 语义）→ 报告：成功/跳过/失败清单 + role 分布 + 未处理余量。
- `--limit=N` 只处理前 N 条待裁决条目。
- 写库 SQL 生成放 `src/lib/llm/enrich.ts` 导出的纯函数（或同目录 `enrich-sql.ts`），补 2-3 条单测（转义、COALESCE 在场）。
- 该脚本仅面向**已入库（published）数据**的存量回填；不需要感知暂存（spec10 未实施）。

### 2.4 真实抽验（唯一一次默认真实 LLM 验证）

`npm run enrich -- --limit=3`：3 条 reason 人工可读（贴原文）；SQL 核验 primary 100% ∈ 候选集（`SELECT item_id, json_extract(result,'$[0].companyId') FROM enrich_cache` 对 item_companies 比对）。**不要打印 .env 或 key**。

## 红线

- 禁止 git commit / git add。
- 只允许改动：`src/lib/llm/enrich.ts`（新建）、`src/lib/llm/enrich.test.ts`（新建）、`src/lib/llm/enrich-sql.ts`（可选新建）、`scripts/enrich.ts`（新建）、`worker/sync/sqlgen.ts`、`worker/sync/sqlgen.test.ts`、`package.json`（仅加 `enrich` script 一行）。其他文件不碰。
- 不进同步关键路径：不得改 `worker/api/routes.ts`、`scripts/sync.ts` 调用链（sqlgen 签名兼容扩展除外）。
- 真实 LLM 调用仅限 2.4（--limit=3）；全量跑由主会话执行。
- 禁止打印 .env 内容与 key 值。

## Acceptance criteria

- [ ] enrich 纯函数单测红→绿（prompt 快照/截断边界/parse 分支/deriveRoles 三样本/SQL 生成）
- [ ] sqlgen COALESCE 语义三条断言绿；`npx vitest run worker/sync/sqlgen.test.ts src/lib/llm/enrich.test.ts` 绿
- [ ] `npm run enrich -- --limit=3` 真实跑通：3 条 reason 贴报 + primary ∈ 候选 SQL 证据
- [ ] `npx tsc --noEmit` 绿；role 分布报告（此时仅 3 条）

## Blocked by

.spec09-llm-curation/issues/01-llm-access-layer.md（已交付）

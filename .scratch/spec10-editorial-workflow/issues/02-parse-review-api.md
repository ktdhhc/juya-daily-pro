# 02 · 解析与审核 API：/api/parse + /api/review/*

Status: ready-for-agent

## What to build

按 `docs/spec/spec10-editorial-workflow.md` Step 2（2.1→2.3）逐步执行。契约以 spec「契约（钉死）」节的「解析与审核 API」节为准。前置：spec10-01 已交付 published 列与两张新表；spec09 已交付 `src/lib/llm/enrich.ts` / `src/lib/llm/propose.ts` 纯函数（enrich 判 primary + deriveRoles；propose 三分类）。

### 2.1 共享 chat 层提取（先核验再动）

- 前置事实核验（spec 要求）：用最小代码在 workerd 里验证 `fetch` + `AbortSignal.timeout`（临时 wrangler dev 实例 + 临时路由或 `wrangler dev --test-v3` 均可，验证后删除痕迹）。通过 → 把 `scripts/lib/llm.ts` 的 `chatJson` / `runWithLimiter`（及其类型 LlmConfig）提取到 `src/lib/llm/chat.ts`（**零 node:fs/node:path import**）；`scripts/lib/llm.ts` 改为 re-export（`export { chatJson, runWithLimiter } from "../../src/lib/llm/chat"`——scripts 侧调用方零改动）。`scripts/lib/llm.test.ts` 保持绿（必要时补 import 路径断言）。
- 核验不通过 → 不提取，在 `src/lib/llm/chat.ts` 写 Worker 等价实现并注释差异；汇报里说明原因。

### 2.2 Worker 配置读取

`worker/api/parse.ts`（新建）：worker env 直接读 `env.LLM_API_BASE / env.LLM_MODEL / env.LLM_API_KEY(secret)`（wrangler.jsonc vars 已有；Env 接口补三个可选字段）。构造 LlmConfig 传给 chatJson。缺 key → 403/500 语义错误（`{ error: { code: "llm_not_configured", message: "缺少 LLM_API_KEY" } }` 500）。

### 2.3 圈题与 SQL 纯函数（先红后绿）

`worker/api/parse.ts` 内导出纯函数（`worker/api/parse.test.ts` 测，先红后绿）：
- `selectParseTargets(items, owners, proposals)`：输入暂存条目 + 其 item_companies + 已有 proposal 集合 → 输出 `{ enrichTargets: [{ itemId, candidates: [{companyId,name,notes,evidence,hitInTitle}] }], missingTargets: [{ itemId, bodyMd, title, summary }] }`——多家命中（≥2）且无 proposal 进 enrichTargets；enrich_state='missing_owner' 进 missingTargets；已有 proposal 或单家命中跳过。
- `proposeInsertSql(candidates)` / `proposalUpsertSql(rows)`：写 company_candidates / item_proposals 的 SQL 生成（sqlgen 纪律：单语句单行、`;` 结尾、escapeSqlText、幂等 upsert）。注意 company_candidates 主键冲突策略：`ON CONFLICT(id) DO NOTHING`（已有同名建议不覆盖）。
- 单测：圈题分支（多家/单家/已有 proposal/missing_owner/非 missing 的零归属？——missing_owner 才进）、SQL 转义与幂等子句。

### 2.4 LLM 编排（薄 IO，不单测）

`POST /api/parse` 流程：requireAdmin → 读暂存条目（published=0）→ selectParseTargets → `runWithLimiter(jobs, MAX_LLM_PER_RUN)`（env 读取，默认 20）→ enrich job：buildEnrichPrompt → chatJson → parseEnrichResponse → 合格者 deriveRoles 成 proposal 行；propose job：buildProposePrompt → chatJson → parseProposeResponse（registryNames 从 companies 表读）→ kind=company 落 company_candidates（product/ignore 仅计数）→ D1 batch 写入 → 返回 `{ processed, candidatesFound, remaining, skipped }`。单条 LLM 失败不阻塞（计入 skipped，附错误清单截断）。

### 2.5 审核端点（薄 IO + 参数校验纯函数）

- `GET /api/review/pending`：published=0 条目按日期升序组装（JOIN owners、LEFT JOIN proposals/candidates）；响应形状按 spec 契约。组装函数导出可测（`assemblePending(...)`）。
- `PATCH /api/review/item`：body 校验纯函数 `validatePatchBody(body): { itemId, owners } | error`（owners 非空、companyId 字符串、role 枚举、**primary 恰好 ≤1**）；通过 → 删该条 item_companies 再插（batch 原子）+ enrich_state='ok'；仅 published=0 条目（否则 400 invalid_param「已入库条目请走人工纠错通道」）。
- `POST /api/review/publish`：`{ dates?: string[] }` 缺省=全部含暂存条目的日期；D1 batch 原子：published 0→1（按日期集合）、应用 proposal owners（同 PATCH 语义）+ 写 enrich_cache（result=owners JSON、llm_model）；返回 `{ publishedDates, itemsPublished }`。
- routes.ts 挂四端点（requireAdmin 全覆盖；GET pending 走 methodGuard 但**不进 withCache**——审核数据必须实时）。

### 2.6 实测

wrangler dev（--var ADMIN_TOKEN:test-token）：/api/parse 无头 403 / 对头 200（**真实 LLM，≤3 条**——MAX_LLM_PER_RUN 与 --limit 语义下用构造的小批次；若本地无暂存数据，先 POST /api/sync 造一批）；pending 两态；patch 一条（改 role）→ pending 里复查生效；publish 指定单期 → 该期内容出现在无头 GET /api/items；重复 parse 幂等（remaining 递减）。测完 taskkill //F //T 杀净。

## 红线

- 禁止 git commit / git add。
- 只允许改动：`worker/api/parse.ts`（新建）、`worker/api/parse.test.ts`（新建）、`worker/api/routes.ts`、`src/lib/llm/chat.ts`（新建，若提取）、`scripts/lib/llm.ts`（re-export 化）、`scripts/lib/llm.test.ts`（必要时）。其他文件不碰（queries.ts/sqlgen.ts 均不碰）。
- 同步段零 LLM 不变；parse 只对 published=0 生效。
- 禁止打印 .env、key、LLM 响应全文（贴 reason 摘要即可）。
- TS strict；ADR-0011：IO 不单测，纯函数全测。

## Acceptance criteria

- [ ] 前置核验结论（workerd fetch/AbortSignal）+ 提取决策说明
- [ ] parse.test.ts 红→绿（圈题/SQL/校验/组装 ≥10 用例）；`npx vitest run` 全量绿
- [ ] 四端点 curl 实测输出（403/200 两态 + publish 后访客可见证据）
- [ ] 真实 LLM 小批次（≤3 条）proposal 与候选落库证据（SQL 查询结果贴报）
- [ ] 双 tsc 绿

## Blocked by

.spec10-editorial-workflow/issues/01-staging-foundation.md
.spec09-llm-curation/issues/02-enrich-job.md 与 03（纯函数必须已在 src/lib/llm/）

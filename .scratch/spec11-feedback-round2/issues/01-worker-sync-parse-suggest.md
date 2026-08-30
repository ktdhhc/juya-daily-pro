# 01 · Worker：stagedDates 修正 + parse 重解析通道 + suggest 端点

Status: ready-for-agent

## What to build

按 `docs/spec/spec11-feedback-round2.md` 契约 A/B/C 三节与 Step 1 执行。**只动 worker/，零前端。**

### 1.1 stagedDates 修正（契约 A）

`worker/api/routes.ts`（或 sync 实现所在处）`syncNow`：响应的 `stagedDates` 改为**批尾一次查询** `SELECT DISTINCT date FROM items WHERE published = 0 ORDER BY date` 的结果（这是「真有暂存」的权威口径）；`dates` 字段语义不变。注意 staged 查询在 batch 之后执行。

### 1.2 parse 圈题扩展（契约 B）

`worker/api/parse.ts` 的 `selectParseTargets` 增加第二类输入：
- 新增参数：`publishedMissingRoles: Array<{ itemId, title, summary, bodyMd, candidates: [...] }>`（调用方查询：published=1、多家命中、无 enrich_cache、且该条目存在 `role IS NULL` 的 item_companies 行）。
- 圈题结果 = 原暂存类 ∪ 该类；两类去重（同一 itemId 以暂存类优先）；`remaining` = 两类条目总数。
- 调用侧补一个查询构造器（可放 parse.ts 内导出）：`buildPublishedMissingRolesQuery()`——多家命中 GROUP BY HAVING ≥2 + LEFT JOIN enrich_cache 为空 + EXISTS role IS NULL，返回条目字段 + 候选（复用既有候选装配逻辑）。
- **单测红→绿**：`worker/api/parse.test.ts` 增用例——两类合并去重、已发布有 enrich_cache 不圈、role 全非 NULL 不圈、暂存类优先。
- 有 enrich_cache 的条目永不被圈（人工纠错走 enrich --apply，spec09）。

### 1.3 suggest 端点（契约 C）

- `worker/api/queries.ts` 新增 `buildSuggestQuery(q: string, limit: number): SqlStatement`：LIKE 匹配 title OR summary（`%`/`_`/`\` 转义与 `/api/items` q 参数同款，参数化绑定），ORDER BY（title LIKE 优先 → CASE WHEN，再 date DESC），LIMIT ?。
- 纯函数 `summarizeMatch(summary: string, q: string): string`（放 queries.ts 或独立 `worker/api/suggest.ts`）：大小写不敏感找命中位置 → 截前后各约 40 字符（总长 ≤81）加省略号；无命中 → summary.slice(0, 80)；空 summary → 空串。**单测红→绿**：命中开头/中间/结尾/超长截断/无命中/空串/大小写。
- 路由：`GET /api/search/suggest`（公开、methodGuard、withCache 60s），组装 `{ items: [...] }`（title 命中排序由 SQL 保证；snippet 只对 summary 生成）。q 为空 → 200 `{ items: [] }`；limit 缺省 8、上限 8（`limit` 参数可忽略固定 8，简单优先）。
- 转义与注入：恶意 q 只进绑定参数，单测断言（EVIL 样式参考 queries.test.ts 既有用例）。

### 1.4 curl 验收（--var ADMIN_TOKEN:test-token 实例）

- suggest：`?q=OpenAI` 有命中且 title 命中排前；`?q=<不存在词>` 空；`?q=%`（转义）不炸不误匹配。
- parse 重解析实测：本地 D1 `DELETE FROM enrich_cache WHERE item_id='20260829-6'` + `UPDATE item_companies SET role=NULL WHERE item_id='20260829-6'` → POST /api/parse → 该条目被圈且成功（真实 LLM，1 条）→ roles 恢复 → 与本票开始前状态核对（原值：google=primary/openai=partner——LLM 可能给出不同主次，只要 primary ∈ 候选即合格；把恢复后的状态贴报即可，不必强求复原）。
- sync stagedDates：对已全发布库跑 POST /api/sync → stagedDates = [] 且 dates 非空（证明不再误报）。

## 红线

- 禁止 git commit / git add。
- 只允许改动：`worker/api/routes.ts`、`worker/api/parse.ts`、`worker/api/parse.test.ts`、`worker/api/queries.ts`、`worker/api/queries.test.ts`、`worker/api/suggest.ts`（可选新建）、`worker/api/suggest.test.ts`（可选新建）。其他文件不碰（尤其 src/、scripts/）。
- TS strict；中文注释；不新增依赖；8787 常驻实例不要动（用 8788/8789 验证，测完 taskkill //F //T 杀净）。
- .dev.vars 已含 LLM_API_KEY（勿打印其值；勿改 .dev.vars）。

## Acceptance criteria

- [ ] parse.test / suggest（或 queries）新增单测红→绿证据；`npx vitest run worker/` 全绿
- [ ] curl 三组证据（suggest 两态+转义 / parse 重解析恢复 / sync stagedDates 空数组）
- [ ] `npx tsc --noEmit -p worker` 绿
- [ ] 汇报：stagedDates 查询位置说明、圈题合并语义表、suggest SQL 形状

## Blocked by

None - can start immediately

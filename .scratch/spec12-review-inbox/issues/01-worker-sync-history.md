# 01 · Worker：sync 响应条数 + /api/review/history 历史端点

Status: ready-for-agent

## What to build

按 `docs/spec/spec12-review-inbox.md` 契约 A 与 F（端点部分）执行。**只动 worker/，零前端。**

### 1.1 sync 响应加 stagedItems（契约 A）

`worker/api/routes.ts` 的 `syncNow`：响应增加 `stagedItems: number`——与 stagedDates 同一次查询处顺带取 `SELECT COUNT(*) FROM items WHERE published = 0`（或一条查询同时取 DISTINCT date 与 COUNT）。响应形状变为 `{ ok, dates, stagedDates, stagedItems, failures }`。

### 1.2 历史端点（契约 F）

- 纯函数 `assembleHistory(syncRows, statRows)`（`worker/api/parse.ts` 或新建 `worker/api/history.ts`）：
  - syncRows: `{ date, status, error, attemptedAt }[]`（sync_log 最近 30 条按 attempted_at 倒序）
  - statRows: `{ date, items, published, attributed }[]`（逐期 items 统计：COUNT、SUM(published)、SUM(enrich_state='ok')）
  - 合并 → `history: [{ date, status, error, attemptedAt, items, published, attributed }]`，无条目期 items/published/attributed=0；**TDD 先红后绿**：合并、倒序保持、无条目期补零、条目数负值/异常输入不炸。
- 查询：`SELECT date, status, error_message AS error, attempted_at AS attemptedAt FROM sync_log ORDER BY attempted_at DESC LIMIT ?`（limit 缺省 30，?limit= 上限 100，非法回退 30）；统计一条 GROUP BY（date IN 子查询或 JOIN，注意 published 列存在于 items）。
- 路由 `GET /api/review/history`（requireAdmin 同款守卫，**不进 withCache**——历史需实时），响应 `{ history: [...] }`。

### 1.3 curl 验收（--var ADMIN_TOKEN:test-token 实例，8788；8787 常驻勿动）

- history：无头 403 / 对头 200；行数 ≤30；抽查一期与 D1 手查对账（date/status/items/published/attributed 五值一致，贴两条对照）。
- sync：POST 后响应含 stagedItems 数值且与 stagedDates 期数对应的条目数一致（贴报）。
- 测完 taskkill //F //T 杀净进程树。

## 红线

- 禁止 git commit / git add。
- 只允许改动：`worker/api/routes.ts`、`worker/api/parse.ts`、`worker/api/parse.test.ts`、`worker/api/history.ts`（可选新建）、`worker/api/history.test.ts`（可选新建）。禁止碰 src/、scripts/。TS strict；中文注释；不新增依赖。
- **绝对不要打印 .dev.vars / .env 的值**。

## Acceptance criteria

- [ ] assembleHistory 单测红→绿；`npx vitest run worker/` 全绿；`npx tsc --noEmit -p worker` 绿
- [ ] curl：history 403/200 两态 + 对账两条；sync 含 stagedItems
- [ ] 汇报：端点响应样例、对账对照、改动文件清单

## Blocked by

None

# 01 · Worker：解析异步作业 + parse_state 落库 + pending 载荷扩展

Status: ready-for-agent

## What to build

按 `docs/spec/spec13-parse-job-state.md` 契约 A/B/C 与执行步骤 1 执行。**只动 worker/ 与 scripts/migrate-staging.sql，零前端。**

### 1.1 迁移增量

`scripts/migrate-staging.sql` 追加契约 A 的 `parse_state` DDL（CREATE TABLE IF NOT EXISTS，天然幂等；文件顶部既有注释说明重跑语义不变）。**不**新建第二个迁移文件。

### 1.2 ctx 线程化

`worker/sync/index.ts`：`fetch(request, env)` → `fetch(request, env, ctx)`（`ctx: ExecutionContext`，scheduled 不动）；`worker/api/routes.ts` `handleApiRequest(request, env, ctx?)` 可选第三参透传（兼容既有调用——无 ctx 回退同步执行）。

### 1.3 parse 异步作业（契约 B）

`worker/api/parse.ts`：
- 纯函数（先红后绿，`parse.test.ts`）：
  - `parseBusy(prev: ParseStateRow | null, now: Date): boolean`——status='running' 且 startedAt 距 now <10 分钟为 busy；超时陈旧 running 不 busy（可覆盖）；null/idle 不 busy。
  - `emptyParseState(): ParseStateRow`（idle 行）与 `assembleParseState(row | null)`（DB 行 → 载荷 `{ status, startedAt, finishedAt, processed, total, remaining, errors: string[] }`，errors JSON 解析容错、idle 归一）。
- 流程改造：POST /api/parse handler 改为——读 state → `parseBusy` → 409 `parse_busy`（响应带 state）；否则置 running（total=圈题数，圈题需先跑 selectParseTargets 的查询——圈题逻辑提出到启动阶段供 total 计数，LLM 调用延后）→ **立即** `jsonOk({ started: true, state })` → 实际执行放 `ctx?.waitUntil(...)`（无 ctx 回退 `await`）。
- 执行体：现有 runParse 改造——增可选 `onProgress(update: { processed, remaining, errors })` 回调（每条完成即回调）；作业写库函数 `writeParseState(env, row)`（upsert 单行）；结束置 done（errors 保留在 errors 字段），try/catch 整体失败置 failed。runParse 签名变更保持兼容（onProgress 可选）。
- 注意：running 写库与执行体写库都走 binding batch/prepare 单语句（SQL 纪律）。

### 1.4 pending 载荷扩展（契约 C）

`reviewPending` 载荷增 `parse: ParseStatePayload`（assembleParseState(parse_state 单行)）——reviewPending 增一条单行 SELECT。

## 红线

- 禁止 git commit / git add。
- 只允许改动：`scripts/migrate-staging.sql`、`worker/sync/index.ts`、`worker/api/routes.ts`、`worker/api/parse.ts`、`worker/api/parse.test.ts`、`worker/api/history.ts|test.ts`（如需复用常量）、`worker/api/parse-state.ts`（可选新建）。禁止碰 src/。
- TS strict；中文注释；不新增依赖。SQL 纪律不变。
- .dev.vars 含真实 LLM key 勿打印。

## Acceptance criteria

- [ ] 纯函数红→绿证据；`npx vitest run worker/` 全绿；`npx tsc --noEmit -p worker` 绿
- [ ] `npm run db:migrate` 后 D1 有 parse_state 空闲行（贴查询）
- [ ] curl（8788 守卫实例，8787 常驻勿动、勿起双实例）：POST parse **秒回** `{started:true}`；立即 GET pending → parse.status='running'（若本轮圈题>0 会短暂运行）；完成后 status='done' 计数齐；running 中再 POST → 409 parse_busy；迁移后首次 idle 态 pending 含 parse 字段
- [ ] 汇报：作业时序说明（启动/进度/结束写库点）、圈题计数与 total 关系、改动文件清单

## Blocked by

None

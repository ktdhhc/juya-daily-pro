# 01 · Worker：sync_runs 运行记录 + /api/review/sync-runs

Status: ready-for-agent

## What to build

按 `docs/spec/spec14-review-control-redo.md` 契约 A/B 执行。**只动 worker/ 与 scripts/migrate-staging.sql，零前端。**

### 1.1 迁移增量

`scripts/migrate-staging.sql` 追加契约 A 的 sync_runs DDL（CREATE TABLE IF NOT EXISTS，幂等；文件头已有 --file 原子事务注释与引导命令，增量追加即可）。

### 1.2 syncNow 落运行记录

`worker/api/routes.ts` syncNow：响应成功路径前 INSERT sync_runs 一行——started_at（ISO now）、duration_ms（函数起止实测）、window_dates/added/updated/unchanged/failures（各自 JSON.stringify）、staged_items、ok（failures.length===0 → 1/0）。纯函数 `syncRunInsertSql(row)`（转义 + SQL 纪律，`worker/api/history.ts` 或新文件均可）红→绿（单测：转义、JSON 字段、ok 映射）。

### 1.3 GET /api/review/sync-runs

- 路由（requireAdmin、methodGuard GET、不进 withCache）：`?limit=20`（纯函数 parseSyncRunsLimit：缺省 20/上限 100/非法回退，对齐 parseHistoryLimit 先例）。
- 查询单条（ORDER BY started_at DESC LIMIT ?）；纯函数 `assembleSyncRuns(rows)`：JSON 字段解析容错（损坏行返回空数组字段而非抛错）、倒序保持、字段映射 → `{ runs: [{ startedAt, durationMs, windowDates, added, updated, unchanged, failures, stagedItems, ok }] }`。**红→绿**（合并/容错/倒序/limit）。
- 测试落 `worker/api/history.test.ts` 或新建 `sync-runs.test.ts`。

### 1.4 curl 验收

8788 守卫实例（**8787 常驻勿动、勿起双实例**）：POST /api/sync 两次 → GET sync-runs 应有 ≥2 行、最新一行三分类与响应一致、倒序正确；403 无头；limit=1 只返回一行。测完 taskkill //F //T 杀净。**绝对不要打印 .dev.vars / .env 值。**

## 红线

禁止 git commit / git add。只允许改动：`scripts/migrate-staging.sql`、`worker/api/routes.ts`、`worker/api/history.ts`、`worker/api/history.test.ts`、`worker/api/sync-runs.ts`（可选新建）、`worker/api/sync-runs.test.ts`（可选新建）。禁止碰 src/。TS strict；中文注释；SQL 纪律。

## Acceptance criteria

- [ ] 纯函数红→绿证据；`npx vitest run worker/` 全绿；`npx tsc --noEmit -p worker` 绿
- [ ] `npm run db:migrate` 后 sync_runs 表可查（贴查询）
- [ ] curl：两次 sync 后 sync-runs ≥2 行且最新行与响应三分类一致；403；limit=1
- [ ] 汇报：改动文件清单、行结构与对账说明

## Blocked by

None

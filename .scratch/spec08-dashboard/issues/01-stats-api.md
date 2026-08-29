# 01 · Worker：GET /api/stats 聚合端点

Status: ready-for-agent

## What to build

按 `docs/spec/spec08-dashboard.md` Step 2（2.1→2.3）执行。契约以 spec「契约（钉死）」节逐字段为准。前置：spec07 已交付 `worker/api/auth.ts` 的 `requireAdmin(envToken, headerToken)` 与 `env.ADMIN_TOKEN`。
**修订（spec10 暂存语义落地后）**：所有 stats 查询必须只统计已发布数据——items 侧一律加 `published = 1` 过滤（daily 聚合、分类、公司 Top、enrich 分布、overview 的 items/attributed 子查询）；sources/issues 计数同加 `published = 1`；sync_log 不过滤。单测补一条「staged 条目不计入聚合」断言（构造器 SQL 含 published 过滤）。

### 2.1 查询构造器 + 组装器（纯函数，先红后绿）

新建 `worker/api/stats.ts`，风格对齐 `worker/api/queries.ts`（构造器返回 `{ sql, params }`，窗口锚点由调用方注入便于测试）：

- `buildOverviewCountsSql()`：单行五值——issues=COUNT(sources)、items=COUNT(items)、companies=COUNT(companies)、attributed=COUNT(items WHERE enrich_state='ok')、last_sync_at=MAX(attempted_at) FROM sync_log WHERE status='ok'（子查询标量写法）。
- `buildDailyItemsSql(from: string)` / `buildDailyIssuesSql(from: string)`：items 按日计数、sources 按日计数，`date >= ?` 绑定参数，升序。
- `mergeDaily(itemRows, issueRows): { date: string; items: number; issues: number }[]`：按 date 合并；**两源皆无的日期不出现**（稀疏数组）；日期升序。
- `buildCategoryAggregateSql()`：category 非空分组计数，count 倒序。
- `buildCompanyTopSql(limit = 12)`：item_companies ⋈ companies 分组计数，count 倒序、id 升序稳定并列，LIMIT ?。
- `buildEnrichDistributionSql()`：enrich_state 分组计数。
- `buildSyncRecentSql(from: string)`：sync_log `date >= ?` 升序取 date/status/error_message。
- `buildStatsResponse(parts): StatsResponse`：组装契约形状——`attributedRate = items>0 ? Math.round(attributed/items*1000)/1000 : 0`；enrich 三桶缺省补 0；sync 行 error_message→error（空串→null）；数值一律 Number() 收敛（D1 可能回字符串）。

**TDD 解释**（你没有 skill，按此手工执行）：先写 `worker/api/stats.test.ts`（mergeDaily 稀疏合并/升序、rate 三位小数与 0 除、enrich 缺桶补 0、sync error null 化、构造器 SQL 含关键子句与参数绑定、buildCompanyTopSql 默认 12），`npx vitest run worker/api/stats.test.ts` 看到失败输出，再实现至全绿，汇报贴红、绿两段证据。类型 `StatsResponse` 导出（对齐 spec 契约字段）。

### 2.2 路由接入

`worker/api/routes.ts`：新增 `GET /api/stats`——`requireAdmin(env.ADMIN_TOKEN, request.headers.get("x-admin-token"))` 不过 → 403 `unauthorized`；过 → `withCache` 包装（60s，仅 200 入缓存）执行五组查询并 `buildStatsResponse` 返回。非 GET 405 沿用 methodGuard 模式（注意 requireAdmin 在 methodGuard 之前判定亦可，二选一保持与 syncRoute 一致风格）。Env 接口无需新增字段（复用 ADMIN_TOKEN）。

### 2.3 实测

`npx wrangler dev --port 8788 --var ADMIN_TOKEN:test-token`（8787 常驻实例不要动）：curl 无头 403 / 对头 200 全键结构（overview 七字段、daily 升序、companies ≤12、enrich 三键、sync ≤84 条）；错误格式对齐 `{ error: { code, message } }`。测完 `taskkill //F //T //PID <pid>` 杀净进程树。

## 红线

- 禁止 git commit / git add。
- 只允许改动：`worker/api/stats.ts`（新建）、`worker/api/stats.test.ts`（新建）、`worker/api/routes.ts`。其他文件一律不碰。
- TS strict；中文注释对齐 queries.ts 风格；不新增依赖；不碰前端文件。

## Acceptance criteria

- [ ] stats 单测红→绿证据；`npx vitest run worker/api/stats.test.ts` 绿
- [ ] curl 两态实测输出（200 全键 / 403 unauthorized）
- [ ] `npx tsc --noEmit -p worker` 绿；`npx vitest run` 全量无回归
- [ ] enrich 三桶之和 == overview.items（对账自证）

## Blocked by

.spec07-role-baseline/issues/01-worker-admin-guard.md（requireAdmin 与 ADMIN_TOKEN 落地后开工）

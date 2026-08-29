# 01 · 暂存基座：published 列 + staged 写入 + 读 API 过滤

Status: ready-for-agent

## What to build

按 `docs/spec/spec10-editorial-workflow.md` Step 1（1.1→1.4）逐步执行。契约以 spec「契约（钉死）」节的「schema」与「同步段」两节为准。**本票零 LLM、零前端。**

### 1.1 迁移脚本

`scripts/migrate-staging.sql`（新建）：
- `ALTER TABLE items ADD COLUMN published INTEGER NOT NULL DEFAULT 1;`
- `ALTER TABLE sources ADD COLUMN published INTEGER NOT NULL DEFAULT 1;`
- CREATE TABLE IF NOT EXISTS：`item_proposals`、`company_candidates`（列定义见 spec 契约，含 CHECK 约束与索引：item_proposals 无需额外索引；company_candidates 加 idx ON status）
- 幂等性：SQLite 的 ADD COLUMN 重复执行会报 duplicate column——脚本顶部写注释说明「重复执行报错可忽略，先 PRAGMA 查列」；或拆两个文件（columns.sql / tables.sql），由调用方先查 `PRAGMA table_info(items)` 决定是否执行。选一种做对即可，附验证命令。
- `package.json` 加 script：`"db:migrate": "wrangler d1 execute juya-daily --local --file scripts/migrate-staging.sql"`（若拆两文件则两条命令 && 串联；**不得**用 npm 依赖，shell 层即可）。

### 1.2 sqlgen staged 语义（先红后绿）

`worker/sync/sqlgen.ts`：
- `sourcesUpsertSql(date, markdown, opts?: { staged?: boolean })`
- `itemsUpsertSql(items, opts?: { staged?: boolean })`
- staged → INSERT 的列清单与 VALUES 显式含 `published` 且置 `0`；非 staged（缺省）→ INSERT 不写 published（落 DEFAULT 1）。**两种形态的 DO UPDATE SET 均不含 published**（重同步不翻转、publish 后不被打回）。
- `worker/sync/sqlgen.test.ts` 先红后绿：staged INSERT 含 published=0 / 缺省不含 published 列 / 两种形态 DO UPDATE 均无 published / 与既有 COALESCE role 语义兼容并存。

### 1.3 同步路径与读 API 过滤

- `worker/sync/index.ts`（POST /api/sync 的实际实现若在此）与 `worker/api/routes.ts` 的 `syncNow`：抓取解析后的 SQL 一律 staged 写入（`{ staged: true }`）；**matchAll/registry 镜像/enrichState 回写不变**。响应体增 `stagedDates: string[]`（成功期，同 dates）。
- 读 API 过滤：`worker/api/queries.ts` 各构造器（itemsDates/itemsForDates/companiesIndex/companyProfile 各查询、daily 的 sources 查询在 routes.ts 直查）统一加 `published = 1` 过滤（注意 sources 与 items 各自过滤；company 统计的 JOIN 侧 items 过滤）。**spec08 未实施，/api/stats 不存在，不用管。**
- `worker/api/queries.test.ts` 先红后绿：各构造器 SQL 含 published 过滤；staged 组合下（无参数变化）仍正确。
- routes.ts `Env` 不变；`POST /api/sync` 响应类型在 `src/lib/api.ts` 的 `SyncResponse` 增 `stagedDates: string[]`（前端 Header 的成功文案改为「同步 N 期（待审核）」——只改这一行文案，不做其他前端改动）。

### 1.4 回归

- `npm run backfill` 语义不变：不跑全量（高成本），以单测 + 一次 `npx wrangler d1 execute juya-daily --local --command "SELECT COUNT(*) FROM items WHERE published=1"` 佐证存量默认 published。
- 迁移后本地 D1 计数对账：items/sources/companies 计数与迁移前一致（迁移只加列）。

## 红线

- 禁止 git commit / git add。
- 只允许改动：`scripts/migrate-staging.sql`（新建）、`package.json`（仅 db:migrate 一行）、`worker/sync/sqlgen.ts`、`worker/sync/sqlgen.test.ts`、`worker/sync/index.ts`、`worker/api/routes.ts`、`worker/api/queries.ts`、`worker/api/queries.test.ts`、`src/lib/api.ts`（SyncResponse 类型 + Header 一行文案，Header.tsx 不碰）。其他文件不碰。
- 同步段零 LLM：不得引入 scripts/lib/llm.ts 或 src/lib/llm/ 的任何调用。
- TS strict；中文注释对齐既有风格。

## Acceptance criteria

- [ ] 迁移幂等验证：`npm run db:migrate` 连跑两次的处理方式明确且第二次不炸（或 PRAGMA 短路）
- [ ] sqlgen / queries 单测红→绿证据；`npx vitest run worker/ src/lib/` 全绿
- [ ] wrangler dev（--var ADMIN_TOKEN:test-token）实测：POST /api/sync 对头 200 且响应含 stagedDates；GET /api/items 对头/无头均**不含**刚同步期内容（published=0）；`SELECT COUNT(*) FROM items WHERE published=0` > 0
- [ ] `npx tsc --noEmit` + `npx tsc --noEmit -p worker` 绿
- [ ] grep 证据：同步调用链无 llm 相关 import

## Blocked by

None - can start immediately

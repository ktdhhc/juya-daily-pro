# 02 · 纯函数 TDD：archive 解析 + SQL 生成

Status: ready-for-agent

## What to build

按 `docs/spec/spec02-local-d1-backfill.md` Step 2：

1. curl 一份真实 archive 页存 `worker/sync/fixtures/archive-sample.html`（`curl -s https://daily.juya.uk/archive/`）。
2. `worker/sync/archive.ts`：`parseArchiveDates(html: string): string[]`（提取 YYYY-MM-DD、去重、倒序）。
3. `worker/sync/sqlgen.ts`：`escapeSqlText` / `sourcesUpsertSql` / `itemsUpsertSql` / `companiesUpsertSql`（列与 ON CONFLICT 规则按 spec 2.2，Item/Company 类型 type-only import 自 `../../src/lib/schema`）。
4. `worker/sync/archive.test.ts` 与 `worker/sync/sqlgen.test.ts`：真实样本断言（条数 > 50、首条 ≥ 2026-08-27）+ spec 列出的全部边界（转义 round-trip、NULL、JSON、ON CONFLICT、空输入、去重）。

**TDD 方式（严格红→绿）**：先写两个测试文件（引用不存在的模块），`npm test` 记录失败（红）→ 实现最小代码 → 逐组转绿（绿）。禁止先实现后补测试。

## Acceptance criteria

- [ ] `npm test` 全绿（spec01 16 个 + 本票新增 ≥8 个）
- [ ] archive-sample.html 已入库；测试含真实样本断言与 inline 边界
- [ ] 四门禁（test/typecheck/lint/build）全绿
- [ ] 未改 parse.ts / parse.test.ts / schema.sql / package.json

## Blocked by

None - can start immediately（与票 01 并行；不改 package.json 避免冲突）

# 01 · wrangler 依赖 + sources 表 + 本地建表

Status: ready-for-agent

## What to build

按 `docs/spec/spec02-local-d1-backfill.md` Step 1：devDeps 安装 `wrangler`（记录版本）；`worker/sync/schema.sql` 追加 sources 表（spec 1.2 的 SQL 原文）；`wrangler.jsonc` 的 `triggers.crons` 改为 `[]` 并注释保留原表达式（对齐 ADR-0013）；执行本地建表并用 sqlite_master 查询验证六表齐备。

TDD 方式：验证命令即测试——建表前 `wrangler d1 execute --local --command "SELECT name FROM sqlite_master..."` 无 sources（红）→ 建表 → 六表齐备（绿）。

## Acceptance criteria

- [ ] `npx wrangler d1 execute juya-daily --local --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"` 输出六表
- [ ] schema.sql 仅追加 sources 块，未动其他表定义
- [ ] wrangler.jsonc：crons `[]` + 注释保留；其余字段未动
- [ ] `npm run typecheck` / `npm run build` 仍绿

## Blocked by

None - can start immediately

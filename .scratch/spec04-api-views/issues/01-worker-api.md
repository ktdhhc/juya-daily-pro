# 01 · Worker read API（5 端点）

Status: ready-for-agent

## What to build

按 `docs/spec/spec04-api-views.md` A 线（A1→A5）逐步执行：worker 独立 tsconfig + workers-types、registry 生成物迁移 src/lib/、queries.ts 纯 SQL 构造器（vitest 单测先行）、routes.ts + worker/sync/index.ts 入口、caches.default 包装、统一错误格式。**契约逐字段以 spec「API 契约」节为准，不得偏离**（前端在按同一契约并行开发）。

TDD 方式：queries 的 SQL 构造器严格先红后绿（先写过滤组合测试再实现）；routes/入口属 Worker fetch 层（ADR-0011 不测），以 wrangler dev + curl 输出为验收——每个端点的 curl 输出摘录进汇报。

## Acceptance criteria

- [ ] `npx wrangler dev` 起服后五端点 + 两个 404 的 curl 输出符合契约（贴汇报）
- [ ] queries SQL 构造器单测覆盖过滤组合与参数化（防注入）
- [ ] registry 生成物迁移后 `npm run gen:registry` 产物 diff 为空、registry.test 迁移后全绿
- [ ] `tsc --noEmit && tsc --noEmit -p worker` 双 typecheck 绿；test/lint/build 绿
- [ ] src/ 下仅 registry.generated.ts / registry.test.ts 变动（schema.ts、juya.ts 等不动）

## Blocked by

None - can start immediately

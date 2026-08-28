# 02 · wrangler-cli 抽取 + match 编排 + 真实匹配运行

Status: ready-for-agent

## What to build

按 `docs/spec/spec03-deterministic-matching.md` Step 3 + Step 4：

1. 新建 `scripts/lib/wrangler-cli.ts`：从 `scripts/backfill.ts` 原样迁移 `runWrangler` / `parseWranglerJson`；backfill.ts 改为 import（行为不变）。
2. `worker/sync/match.ts`：`matchAll(items, registry)` 纯编排（调 ownersByMatching 聚合 ownerRows / okIds / missingIds）+ `worker/sync/match.test.ts`（0/1/2 家命中聚合形态）。
3. `scripts/match-all.ts`（`npm run match:all`）：D1 读 companies + items（--json，注意 maxBuffer）→ matchAll → sqlgen（票 01 的两个函数）→ 临时 SQL → `wrangler d1 execute --local --file` → 删除 → 统计打印（ownerRows 行数、0/1/≥2 分布、ok/missing_owner 计数）。
4. 真实运行 + 二次幂等（两轮计数逐字一致）。
5. 抽样核验：Anthropic 样本行、enrich_state 分布（ok + missing_owner = 1105）、`role IS NOT NULL` 计数 = 0。

TDD 方式：matchAll 走 vitest 红→绿；胶水脚本以真实运行输出为验收。

## Acceptance criteria

- [ ] `npm test` 全绿；matchAll 有测试
- [ ] backfill.ts 改 import 后行为不变（四门禁绿即可，不重跑回填）
- [ ] `npm run match:all` 成功且二次幂等
- [ ] enrich_state 分布总和 1105；role 非空计数 = 0
- [ ] 抽样查询原文贴汇报
- [ ] 零 LLM、零登录

## Blocked by

- 01-match-tests-sqlgen.md

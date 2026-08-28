# 02 · parseIssue 完整 Item 解析器（TDD）

Status: ready-for-agent

## What to build

按 `docs/spec/spec01-issue-parser.md` Step 2 完整执行：在 `worker/sync/parse.ts` 实现 `parseIssue(md: string): ParsedIssue` 纯函数（契约、全部解析规则、id fallback、enrichState 规则以 spec 2.1/2.2 为准，逐条照做），并写 `worker/sync/parse.test.ts`（两份 fixture 快照 + 全部边界 case，fixture 计数断言 19 / 14）。

**TDD 方式（严格执行红→绿循环）**：
1. 先写测试（引用尚不存在的 `worker/sync/parse.ts`），跑 `npm test parse` 看它失败——这是"红"，保留失败输出作为证据。
2. 实现 parse.ts 的最小版本让测试逐组转绿；每修一组边界 case 复跑一次。
3. 全绿后跑 `npm test` / `npm run typecheck` / `npm run lint` / `npm run build` 四门禁。
4. 若实现过程中发现 spec 规则与 fixture 真实结构冲突（解析规则覆盖不到的真实形态），**停下在汇报中说明**，不要擅自发明规则。

fixtures 在 `worker/sync/fixtures/`（2026-08-27.md、2026-08-25.md，已就位）。Item 类型 `import type { Item } from "../../src/lib/schema"`，owners 恒 `[]`、enrichState 只产 `ok | pending`。

## Acceptance criteria

- [ ] `npm test parse` 全绿；先红后绿的过程在汇报中有记录
- [ ] fixture 快照 + ≥8 个边界 case + 计数断言（19/14）齐备
- [ ] `npm test` / `npm run typecheck` / `npm run lint` / `npm run build` 全绿
- [ ] parse.ts 纯函数（无 fetch/IO/Node API）；`src/` 目录零改动

## Blocked by

- 01-vitest-infra.md

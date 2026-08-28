# 01 · matchCompanies 单测 + sqlgen 扩展（先红后绿）

Status: ready-for-agent

## What to build

按 `docs/spec/spec03-deterministic-matching.md` Step 1 + Step 2：

1. `src/lib/matchCompanies.test.ts`：9 类用例（字面量/正则/混合/多别名聚合/retired 跳过/0 命中/多家并列无 role/大小写不敏感/字面量特殊字符不解释）。
2. `worker/sync/sqlgen.ts` 新增 `itemCompaniesUpsertSql`（role 恒 NULL）与 `enrichStateUpdateSql`（两条 UPDATE ... IN），测试并入 `worker/sync/sqlgen.test.ts`。

**TDD 方式（严格红→绿）**：先写测试（此时 sqlgen 新函数不存在、matchCompanies 无测试覆盖），跑 `npm test` 记录新增测试的失败（红）→ 最小实现 → 转绿（绿）。matchCompanies 测试若暴露实现缺陷：最小修复并在汇报点名，禁止重构。

## Acceptance criteria

- [ ] `npm test` 全绿（52 + 新增 ≥12）
- [ ] matchCompanies 9 类用例齐备；sqlgen 两函数含 expectDiscipline 纪律断言
- [ ] 四门禁绿
- [ ] `matchCompanies.ts` 实现未被重构（最多缺陷级最小修复）

## Blocked by

None - can start immediately

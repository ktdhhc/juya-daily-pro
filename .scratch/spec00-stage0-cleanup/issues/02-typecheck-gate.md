# 02 · typecheck 门禁与存量类型修复

Status: ready-for-agent

## What to build

按 `docs/spec/spec00-stage0-cleanup.md` Step 2 建立 typecheck 门禁：`package.json` scripts 增加 `"typecheck": "tsc --noEmit"`（tsconfig 已是 strict，不改 tsconfig）。首次运行如出现存量类型错误，做**最小修复**——只修类型表达（缺失类型标注、错误的类型断言、隐式 any 等），禁止改变运行时行为、禁止重构。

测试方式（TDD）：先 `npm run typecheck` 观察现状（当前无此 script，即失败态）→ 加 script → 逐条修复至退出码 0。

## Acceptance criteria

- [ ] `npm run typecheck` 退出码 0
- [ ] package.json 仅新增 typecheck script，未动其他 scripts/依赖
- [ ] 类型修复未改变任何运行时行为（review 时逐条核对）

## Blocked by

None - can start immediately

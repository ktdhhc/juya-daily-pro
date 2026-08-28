# 01 · Vitest 测试基建

Status: ready-for-agent

## What to build

按 `docs/spec/spec01-issue-parser.md` Step 1：devDeps 安装 `vitest`（记录实际解析版本），package.json scripts 加 `"test": "vitest run --passWithNoTests"`。零 vitest 配置文件（自动发现 `*.test.ts` 即可，node 环境）。

TDD 方式：本票的"测试"是命令本身——先 `npm test`（无 script，失败态）→ 加 script 与依赖 → `npm test` 退出码 0（当前无测试文件，--passWithNoTests 保证绿）。

## Acceptance criteria

- [ ] `npm test` 退出码 0
- [ ] package.json 仅新增 test script 与 vitest devDep，lockfile 同步
- [ ] `npm run typecheck` / `npm run lint` / `npm run build` 仍全绿

## Blocked by

None - can start immediately

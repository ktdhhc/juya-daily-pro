# 04 · CI workflow（typecheck + lint + build）

Status: ready-for-agent

## What to build

按 `docs/spec/spec00-stage0-cleanup.md` Step 4 新增 `.github/workflows/ci.yml`（当前仓库无 .github 目录）：

- 触发：push（main 与 feature/* 分支）与 pull_request
- 步骤：checkout → setup-node 20（cache: npm）→ `npm ci` → `npm run typecheck` → `npm run lint` → `npm run build`
- **无部署 step**（部署日另行处理，ADR-0013）

测试方式：本地依序执行三个命令验证全绿；用 node（如 `node -e "await import('yaml')"` 不装依赖则人工核验）或仔细人工检查 YAML 缩进与语法。

注意：依赖 02/03 的 scripts 存在、lock 文件同步。

## Acceptance criteria

- [ ] `.github/workflows/ci.yml` 存在，含 typecheck/lint/build 三步、无部署步骤
- [ ] 本地 `npm ci && npm run typecheck && npm run lint && npm run build` 全部通过
- [ ] YAML 语法正确（缩进、run 块）

## Blocked by

- 02-typecheck-gate.md
- 03-eslint-gate.md

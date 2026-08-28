# 03 · eslint 最简配置与门禁

Status: ready-for-agent

## What to build

按 `docs/spec/spec00-stage0-cleanup.md` Step 3 建立最简 eslint 门禁：

1. 安装 devDeps：`eslint` 与 `eslint-config-next`（npm 安装实际解析版本，与 Next 16 兼容；package-lock.json 会随之更新，需保留）。
2. 新增 `eslint.config.mjs` flat config：继承 `next/core-web-vitals` 与 `next/typescript`；忽略 `.next/`、`out/`、`worker/`。
3. `package.json` scripts 增加 `"lint": "eslint ."`。
4. 存量报错处理：既有代码的样式类规则可在配置里精确降级为 warn 或 off（列出规则名），但正确性规则（no-unused-vars / no-undef / react-hooks/rules-of-hooks 等）必须保持 error 且修复报错点。

测试方式（TDD）：先跑 `npx eslint .`（未配置时会失败）→ 配置 → 调规则/修正确性报错 → `npm run lint` 退出码 0。

注意：本票与 02 都写 package.json，**串行执行**（02 完成后再开始）。

## Acceptance criteria

- [ ] `npm run lint` 退出码 0
- [ ] eslint.config.mjs 存在且忽略 .next/ out/ worker/
- [ ] 正确性规则未被打包关闭（配置中显式降级的规则均与样式相关）
- [ ] package-lock.json 与 package.json 同步（`npm ci` 可用）

## Blocked by

- 02-typecheck-gate.md（package.json 串行 + 需要类型干净的基线）

# Spec 00 Code Review · 2026-08-29

审查范围：feature/pro 工作区全部未提交改动（实现 spec00-stage0-cleanup）。审查人：主会话（逐文件读 diff）。

## 结论：PASS（无 P0 / 无 P1，无需追加修复票）

## 验收核验（主会话独立复跑，不采信 agent 自报）

- [x] `grep -rn "site-badge\|botanical" src/` 零命中
- [x] `npm run typecheck` 退出码 0
- [x] `npm run lint` 退出码 0（0 errors / 5 warnings）
- [x] `npm run build` 成功，`out/index.html` 产出
- [x] `src/lib/github.ts` 已删（git mv 保留历史）→ `src/lib/juya.ts`；`grep -rn "lib/github" src/` 零命中
- [x] `.github/workflows/ci.yml` 含 typecheck/lint/build 三步、无部署 step
- [x] 首页行为未变（agent B 已 curl 200 + 骨架标记；diff 核对仅 import 路径与注释变化）

## 分级发现

### P0（阻塞）

无。

### P1（需追加票修复）

无。

### P2（记录，后续 spec 择机处理）

1. **`react-hooks/set-state-in-effect` 5 处 warn**（DailyPage.tsx ×3、ThemeToggle.tsx ×2 处中 4 处命中）：挂载期 props→state 同步的既有模式，本 spec 零行为变更约束下不重构，已在 eslint.config.mjs 注明理由并保留可见性。→ 建议 spec 04 前端改造时顺手收敛（届时会重写 DailyPage 状态流）。
2. **`npm audit` 4 个 high（传递依赖）**：来自 eslint 插件链与既有依赖，均为 devDependency 链路，不进生产构建产物。→ 记录在案，不阻塞；若后续想处理，单独票跑 `npm audit fix` 并全量回归。

### P3（观察项，无行动）

1. ci.yml 无 `permissions:` 显式声明（默认 token 权限）；个人仓库可接受。
2. `pull_request:` 裸触发与 push 同分支时可能重复跑 CI，浪费分钟数，量级可忽略。
3. spec「前置事实」曾写 `.site-badge` 为"5 个主题变体"，实际 4 个（mono/cyber/dune/blueprint）——agent 已按实际内容处理，spec 措辞误差无影响。
4. spec 低估 `lib/github` importer 数量（列 2 处，实际 4 处，含 ArticleView/DatePicker）——agent 按红→绿流程自行发现并全部修复，流程按设计工作了。

## 亮点

- 票 05 的红→绿如实发生：更名后 typecheck 报 9 错，修 import 归零——spec 的"测试命令即测试"在配置类工作中运转有效。
- dev 进程清理到位（Windows 下 npm 父进程与 next 子进程分开 taskkill），未留僵尸进程占端口。

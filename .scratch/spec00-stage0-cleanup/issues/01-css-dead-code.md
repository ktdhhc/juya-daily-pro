# 01 · globals.css 死代码清除

Status: ready-for-agent

## What to build

按 `docs/spec/spec00-stage0-cleanup.md` Step 1 清除 `src/app/globals.css` 中的历史死代码：删除 `.site-badge` 主规则与其全部 `[data-theme=...]` 变体；随后全仓（src/ 下 tsx/ts/css）grep `site-badge` 与 `botanical`，对仍存在的 `--botanical-*` 变量定义或引用一并删除。这是已废弃 botanical 主题的残留，其中 mono 变体引用了未定义变量。

测试方式（TDD）：先跑验证命令观察失败 → 删除 → 复跑至通过。
- 失败证据：`grep -rn "site-badge\|botanical" src/` 有命中
- 通过证据：该 grep 零命中 且 `npm run build` 成功

## Acceptance criteria

- [ ] `grep -rn "site-badge\|botanical" src/` 零命中
- [ ] `npm run build` 成功
- [ ] 未改动 globals.css 中任何非 botanical/site-badge 的规则

## Blocked by

None - can start immediately

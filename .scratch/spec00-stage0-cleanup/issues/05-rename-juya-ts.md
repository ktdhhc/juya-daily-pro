# 05 · github.ts 更名 juya.ts（零行为变更）

Status: ready-for-agent

## What to build

按 `docs/spec/spec00-stage0-cleanup.md` Step 5：

1. `git mv src/lib/github.ts src/lib/juya.ts`。
2. 更新 `src/app/page.tsx`、`src/components/DailyPage.tsx` 的 import（`@/lib/github` → `@/lib/juya`）。
3. 文件头注释保留数据源说明，追加一行：`// 部署日（ADR-0013）首页将迁移到 /api/daily/:date，届时本文件 fetch 链路下沉 Worker，前端仅保留渲染。`
4. **禁止**：删除 fetchDailyList / fetchDailyContent、改函数签名、改行为、顺手重构 parseMarkdown（spec 01 的事）。

测试方式（TDD）：先记录基线 `npm run typecheck`（0 错）→ 更名 → 若有 import 漏改，typecheck 立即失败（红）→ 修复至 0 错（绿）→ `npm run build` 成功 → `npm run dev` 后 curl 首页 HTML 验证有内容标记。

## Acceptance criteria

- [ ] `src/lib/github.ts` 不存在，`src/lib/juya.ts` 存在（git mv 保留历史）
- [ ] `grep -rn "lib/github" src/` 零命中
- [ ] `npm run typecheck` 0 错；`npm run build` 成功
- [ ] `npm run dev` 启动后 `curl http://localhost:3000/` 返回含骨架/标题标记的 HTML（行为未变）
- [ ] fetchDailyList / fetchDailyContent / parseMarkdown 签名与行为与更名前完全一致

## Blocked by

- 02-typecheck-gate.md（需要 typecheck 基线可用）

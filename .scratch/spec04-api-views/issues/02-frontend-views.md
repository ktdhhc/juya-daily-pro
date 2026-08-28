# 02 · 前端三视图 + 「合订本×轻科技」界面落地

Status: ready-for-agent

## What to build

按 `docs/spec/spec04-api-views.md` B 线（B1→B8）逐步执行。**视觉契约 = `docs/FRONTEND_DESIGN.md`（逐条落实，§6 反通用三问是自检标准）**；数据契约 = spec「API 契约」节（Worker 由并行 agent 开发，你只按契约写 fetch 与类型，fetch 失败走失败空态，不做 mock）。

顺序：B1 tokens/公共类 → B2 Header 报头 → B3 ItemCard → B4 /stream → B5 /company → B6 /company/[id] → B7 阅读页一致性（合订本 + 骨架）→ B8 build 验证。

约束提醒：
- `/company/[id]` 的 generateStaticParams 从 `@/lib/registry.generated` 枚举（该迁移由并行 agent 负责，你按最终路径 import；若开始时文件还没迁好，先用 worker 路径占位并在汇报注明，集成阶段会统一）。
- facet ↔ URL 双向同步复用 DailyPage 的 popstate 范式；before_date 不进 URL（ADR-0012）。
- 禁 animate-pulse / rounded-full 徽章 / 彩色渐变 / shadow-sm 默认卡片（FRONTEND_DESIGN §3 黑名单）。
- 主题切换、ThemeToggle、6 主题变量名不动；cyber 仅去辉光。

TDD 方式：本票以视觉/交互为主，vitest 不强制新增（既有测试必须保持绿）；FRONTEND_DESIGN §6 三问作为自查清单逐组件过。

## Acceptance criteria

- [ ] 三视图组件齐备且按 FRONTEND_DESIGN 落地（页边编号列、钤印、细线、竖排标签、ink-sweep 骨架）
- [ ] /stream：facet 双向同步 + 滚动翻页 + 三种空态
- [ ] /company/[id]：档案头五块 + 分类分布条形（无图表库）+ 差异渲染卡片
- [ ] 阅读页：合订本日历 + galley 骨架 + 报头 Nav；阅读核心流程（选期/主题切换）不回归
- [ ] `npm run build` 成功且 out/ 含 /company/<30 家 slug> 静态页；四门禁绿
- [ ] FRONTEND_DESIGN §6 三问自查表填进汇报

## Blocked by

None - can start immediately（与票 01 并行；不碰 worker/、package.json、tsconfig）

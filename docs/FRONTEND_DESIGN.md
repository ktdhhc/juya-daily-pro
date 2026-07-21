# FRONTEND_DESIGN

> **状态**：暂缓（用户明确要求 MVP 阶段不写）。
>
> 本文件最终形态将沉淀 6 套主题视觉约束、4 视图布局与卡片信息层级、空态 / 骨架 / 404 / fetch 失败的渲染规范等。在落地完成前，前端规范临时参考：
>
> - 6 套主题 CSS 变量：`src/app/globals.css` 中 `[data-theme="..."]` 块
> - 6 个已有组件：`src/components/` 下的 ArticleView / DailyPage / Header / DatePicker / ThemeProvider / ThemeToggle
> - 时间线 / 公司页卡片与档案头字段：见 `docs/PRD.md` Implementation Decisions 段
> - 空态与加载态：见 `docs/PRD.md` Out of Scope 与 ADR-0011
>
> 当 MVP 阶段 4（read API + 三视图）落地完成、视觉与交互边界稳定后，再由 prebuild-docs skill 二次生成此文件。届时把上述临时代用项整理进本文件，并删除本提示。
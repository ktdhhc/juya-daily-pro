# docs/plans

本目录用于存放项目方案和重要演进说明，不是日常记录或临时调试材料的归档处。

## 适合放入

- 项目初版方案
- feature 设计方案
- 核心流程改版方案
- 数据结构改版方案
- 前端大调整方案
- 重大 prompt / workflow 调整方案
- 架构取舍说明

## 不适合放入

- 日常工作记录
- 每次小修改的说明
- 临时排障过程
- 与当前项目已无关的废弃草案
- 已经被 `docs/CURRENT_STATE.md` 覆盖的当前事实

## 与 ADR 的关系

- `docs/adr/` 记录单点架构决策的"为什么"。
- `docs/plans/` 记录跨多个 ADR 与多个阶段的"怎么做"——按主题、按阶段铺开执行路径。
- 一个 plan 通常引用多枚 ADR 作为依据；A new ADR 不需要写进 plans。

## 命名规则

- 使用清晰、语义化、面向主题的英文 kebab-case 文件名。
- 不默认用日期开头，除非项目强依赖版本或阶段时间线。
- 文件名优先表达内容主题。

## 当前推荐文件

```text
product-engineering-roadmap.md   产品工程侧落地大纲（Phase 0-4 宏观路线）
mvp-build-phases.md              MVP 内部 0-5 子阶段执行计划
rag-phase-plan.md                二期 RAG 落地方案（待 Phase 3 启动时再写）
```

## 当前已有文件

- `product-engineering-roadmap.md` — 产品宏观 phase 划分（0 立基 / 1 MVP / 2 检索+智能化 / 3 RAG 问答 / 4 产品化）。
- `mvp-build-phases.md` — Phase 1 内部 6 个子阶段的执行顺序与每段验证方式。
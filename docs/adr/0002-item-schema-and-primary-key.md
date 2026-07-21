# Item schema：保留 bodyMd 与 `YYYYMMDD-N` 主键

## Context

Item 是本项目数据原子单位，schema 一旦定型会被下游 enrich、时间线渲染、公司页详情、未来 LLM 二次加工同时依赖。两处关键取舍：

- 主键形式：UUID / 自增整数 / `YYYYMMDD-N` 三选一。
- bodyMd 是否保留正文原文，还是只存 summary。

## Decision

- **主键用 `YYYYMMDD-N`**：可人读、和日报里的 `#N` 一一对应、稳定排序、便于 debug。
- **保留 `bodyMd` 字段存正文 markdown 原文**：用于公司页详情展开、未来 RAG/LLM 二次加工。
- **`summary` 字段保留日报概览 `>` 后那句，绝不二次补全**。
- **不引入 schemaVersion / 迁移机制**（MVP 阶段）：schema 变更即重新 build。
- Company 归属 `owners[]` 0..N 个元素，单家归属时 `role` 缺省、多家时每家带 Role（`primary` / `partner` / `subject`）。

## Why not the alternatives

- UUID 主键：稳定但无人读性，debug 困难。
- 只存 summary 不存 bodyMd：items.json 体积小 5x，但公司页详情展开没内容、未来 LLM 介入失上下文。全量几十天的 items.json 也只到几 MB，可接受。

## Consequences

- items.json 体积达几 MB 量级，但仍在可静态打包范围。
- schema 变更 = 重新跑 extract，未来加字段需有此预期。
- 不带 schemaVersion 意味着 items.json 格式出问题时只能整体重建，不能增量迁移。
# 存储栈：D1 主存 + R2 原文归档 + 二期 Vectorize 语义索引

> **修订 2026-08-28（ADR-0013 / 0014）**：R2 原文归档改为 D1 `sources` 表（六表、单引擎）；写入侧 cron 改为 v1 手动 `npm run sync`（部署日恢复 cron）；二期 Vectorize 随 RAG 整体裁剪。"D1 主存"决策不变。

## Context

本项目长期目标包含 AI 资讯问答 agent 与 RAG，且要部署在 Cloudflare 上供多用户查阅。选取存储栈需要同时支持：

- 关系查询（按公司 + 日期范围 + 分类筛选 Item）
- 全文检索的自然嵌合
- 未来引入 RAG 时的向量检索
- daily.juya.uk 每日自动同步且数据持续增长，不污染仓库

## Decision

- **前端**：Cloudflare Pages Static Assets 承载 Next.js 静态导出
- **原文归档**：R2 对象存储 `daily/<YYYY-MM-DD>.md`，~30KB/天。功能：审计回放；任何 schema 变更后可从 R2 全量重解析回填 D1，不依赖第三方源在线
- **结构化主存**：D1（serverless SQLite），三张表
  - `items`：id PK、date、tag、category、title、primary_link、summary、body_md、related_links JSON、enrich_state
  - `item_companies`：item_id、company_id、role（多对多关联）
  - `companies`：镜像 Company Registry（白名单）便于查询
- **写入侧**：一个 Worker 跑 cron trigger，每 6 小时检查 archive 缺期 → 拉取 markdown → 写 R2 → parse → 白名单匹配 → 必要时 LLM enrich → upsert D1
- **读取侧**：同一 Worker 暴露 `/api/items?company=&from=&to=&category=`、`/api/companies/:id` 给前端 fetch
- **二期（RAG 页落地时再引入 Vectorize）**：把 Item 的 `summary + bodyMd` 分块 → embedding → 写入 Vectorize index；检索后按 `item_id` join 回 D1 补展示字段

## Why not the alternatives

- **GH Actions commit JSON + Cloudflare Pages redeploy**：复杂度低但语义检索在浏览器内不可行（RAG 必然失败）；数据进 git 仓库一年几十 MB commit history 膨胀严重。
- **Workers KV**：纯 K-V 模型，按公司 + 日期范围 + 分类的多 facet 筛选只能客户端拉全量再过滤，一年几百天 × 十几条尚可但语义别扭；且完全不接入向量检索。
- **三选项中只有 D1 + R2 同时满足"关系查询 / RAG 就绪 / 仓库不膨胀"三个诉求**。

## Consequences

- 仓库 `data/items.json` 这条思路整体弃用，只保留 `data/companies.yaml` 作为 Company Registry 源（运行时由脚本同步到 D1）。
- 一次 schema 变更不需要抓回历史重解析——R2 已存原文，重新提取一遍 D1 即可。
- D1 写入只在 Worker cron 与首次回填两个入口，前端只读。
- 跨系统一致性：R2 与 D1 之间通过 cron Worker 的事务化写入保证；R2 写成功但 D1 upsert 失败的窗口允许存在（重跑 cron 即可补齐）。
- RAG 页落地时需要新增 Vectorize index 与 LLM API key 等运维项，二期 ADR 再记。
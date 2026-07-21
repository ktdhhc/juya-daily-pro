# 产品工程落地大纲

## 1. 背景

`docs/prd/PRD.md` 与 11 枚 ADR 已锁定 MVP 范围与架构取舍，`docs/plans/mvp-build-phases.md` 已把 MVP 内部的 0-5 阶段铺开。但项目长期目标还包含 RAG、AI 问答、多用户产品化等迭代，这些不在 MVP 里，又需要在工程侧预留 hooks、避免后期大改。本文站在产品宏观视角，规划从 MVP 到后续迭代的 phase 划分、各 phase 出口标准、依赖的 ADR / 子计划、reso 人月。

本文与 `mvp-build-phases.md` 的关系：mvp-build-phases 描述 Phase 1 内部的 6 个子阶段，本文描述更高一级的产品 phase。

## 2. 总览 phase

```text
Phase 0  立基          [已完成]      docs 体系 + 基础 schema/wrangler/next.config 已就位
Phase 1  MVP           [进行中]      四视图 + cron 自动同步 + D1/R2，详见 mvp-build-phases.md
Phase 2  检索 + 智能化  [未启动]      全文检索 + LLM 话题聚类 + 公司简介 LLM 自动生成
Phase 3  RAG 问答      [未启动]      Vectorize 索引 + /ask 视图 + cite sources
Phase 4  产品化        [未启动]      多用户、监控、备份与运维、性能优化
```

## 3. Phase 0 · 立基（已完成）

### 目标
- 决策固化：术语、PRD、11 枚 ADR。
- 基础设施就位：`wrangler.jsonc` / `.dev.vars` / `next.config.ts` rewrites / `src/lib/schema.ts` / `src/lib/matchCompanies.ts` / `worker/sync/schema.sql` / `data/companies.yaml`。
- 文档体系分层：AGENTS.md / CONTEXT.md / docs/CURRENT_STATE.md / docs/FRONTEND_DESIGN.md (stub) / docs/plans/ / docs/adr/ / docs/prd/PRD.md。

### 出口标准（已满足）
- prebuild-docs skill `validate_doc_set` 通过。
- git 分支 `plus` 已建并完成首条 commit。
- 11 枚 ADR 全部落地、互引用一致。

### 非目标
- 任何可运行功能（不是 MVP，仅做地基）。

## 4. Phase 1 · MVP（进行中）

### 目标
让"按时间线 + 公司"重新整理的查阅站点上线可访问，自动同步 daily.juya.uk 每日新期。

### 包含
- 4 路由（`/`、`/timeline`、`/company`、`/company/[id]`）+ 顶部 Nav 三联 + 共用 Header
- Cloudflare Worker cron trigger（北京 08-11 半点，6 次/天）
- D1 五表 + R2 原文归档 + read API 5 端点
- Company Registry 30 家种子 + LLM 限多家归属单分类
- 4 个空态 UI
- Vitest 覆盖纯函数（parseMarkdown / matchCompanies / 启发式 role 补全）

### 详细子阶段
完全由 `docs/plans/mvp-build-phases.md` 接管：阶段 0 清债、阶段 1 解析器、阶段 2 D1 回填、阶段 3 enrich、阶段 4 read API + 三视图、阶段 5 cron。本文不重复。

### 出口标准
- 公网 Cloudflare Pages 域名可访问，四视图切换顺畅。
- 当日新期最坏滞后 30 分钟内出现在所有视图。
- 抽样企业（Anthropic / OpenAI / Anthropic 关联公司）的档案头五块字段齐全。
- Vitest 全绿、typecheck 全绿、CI 部署链路通。

### 非目标
- 全文检索 / 语义检索 / RAG（Phase 2-3）
- 跨日话题聚类 / 公司简介自动生成（Phase 2）
- 多用户 / 监控 / 备份（Phase 4）
- AI 问答页（Phase 3）

### 依赖的 ADR
ADR-0001 至 ADR-0011 全部。

## 5. Phase 2 · 检索 + 智能化（未启动）

### 目标
让"按公司捋清信息"从被动浏览升级为主动查询，让长尾公司画像自动浮现。

### 包含
- **全文检索**：flexsearch 客户端索引 `title + summary + bodyMd`，顶部搜索框、命中高亮、跨期定位。零后端。
- **LLM 话题聚类**：把"Kimi IPO 传闻"这种跨日报道聚成一条时间线带子事件。LLM 二级介入、可接口关闭。
- **公司简介 LLM 自动生成**：每个 Company `notes` 字段可由 LLM 基于该公司的近 30 天 items 数据每月跑一次自动生成二句话，仍由人工 review 后写回 `companies.yaml`。
- **公司数据可视化**：公司页底部追加简单的活动热度图（按天事件数），不上第三方图表库（用 SVG 自绘 ≤ 100 行）。

### 出口标准
- 搜索"Kimi 上市"能在 cursor 分页结果中高亮返回所有相关 Item。
- "Kimi IPO" 这类跨日事件在时间线上显示为单一主题卡片带 N 条子事件，可展开。
- 公司页 `notes` 由 LLM 月度提议写 `companies-pending.yaml`，人工 budget ≤ 5 分钟/月。
- 公司页活动热度图正确显示，无第三方 chart 依赖。

### 非目标
- 语义跨公司聚类（行业主题 graph）
- 自动告警 / 订阅推送
- RAG 问答（Phase 3）

### 依赖的 ADR
- ADR-0001（白名单真相源，不变）
- ADR-0002（Item schema 不变，可能新增 derived 字段如 `cluster_id`）
- ADR-0009（LLM 任务设计原则不变，新增 prompt 任务）
- 新增 ADR-0012（待写）：话题聚类缓存策略与 `cluster_id` schema 设计

## 6. Phase 3 · RAG 问答（未启动）

### 目标
引入语义检索 + AI 概览，回答"Kimi 最近发生了什么"这类自然语言问题。

### 包含
- **Vectorize index**：用 Workers AI embedding 把每个 Item 的 `summary + bodyMd` 分块（建议每块 256 token、50 token overlap）写入 Vectorize，item_id 作为 metadata。
- **`/ask` 视图**：顶部输入框 + 左侧对话历史 + 右侧回答 + citations（链接到原 Item 与原 Daily Issue）。
- **RAG 答时同前 join**：检索后按 item_id 回 D1 取展示字段，复用 read API。
- **流式响应**：用 Workers AI streaming（ReadableStream）逐步输出回答。
- **配额控制**：单 IP 每天最多 N 次问答，超过提示；个人用户场景而非企业级 SLA。
- **citation 链接回原 Item**：回答里每个引用块点击跳到 `/timeline?<filter to that item>` 或直接弹卡片。

### 出口标准
- "Kimi 最近发生了什么"的回答 cite 至少 3 条真实 Item，无 hallucination 编造。
- 单次问答 P95 < 8s（含 embedding 检索 + LLM 流式）。
- 配额策略生效，未付费用户不会无限消耗 LLM 配额。
- 重新跑 cron 后新增 Item 自动进 Vectorize（无需手工重跑）。

### 非目标
- 跨用户对话记忆（每个用户独立 session 不持久化）
- 自定义模型切换（MVP 用 Workers AI 一家）
- 企业级 RBAC / 审计

### 依赖的 ADR
- ADR-0005 storage stack 的 RAG 设想在此 phase 落地
- ADR-0006 env-driven runtime 参数继续适用（新增 `VECTORIZE_INDEX_NAME`、`RAG_LLM_MODEL` 等）
- 新增 ADR-0013（待写）：Vectorize index schema 与 RAG 流水线设计
- 新增 ADR-0014（待写）：配额策略与限流实现

## 7. Phase 4 · 产品化（未启动）

### 目标
从"个人查阅工具"延伸到"多用户查阅产品"，加固运维与稳定性。

### 包含
- **多用户基础设施**：无账号系统（仍匿名），但加配额、速率限制、被滥用防护（Cloudflare WAF / Turnstile）。
- **监控与告警**：cron 失败 / D1 不可达 / R2 写失败时通过 Email Routing 或 Discord webhook 告警（避免 dev-only 的 `sync_log` 黑洞）。
- **备份策略**：R2 原文已是天然备份；D1 通过 `wrangler d1 export` 定期导出到 R2 另一 bucket，作 daily snapshot。
- **性能优化**：read API 加 Edge Cache Reserve、首页 SSR 或 ISR（重新评估 `output: export` 静态导出是否仍合理）；首页 critical path 数据预取。
- **可观测性**：Workers Logs 接 Cloudflare Logpush，Item 入库延迟、LLM 调用成功率、cron 频率可视化。

### 出口标准
- 监控 dashboard 显示最近 7 天 cron 成功率 ≥ 99%、LLM 失败可追溯。
- D1 每日 snapshot 在 R2 上可见、人工 restore 测试通过。
- 首页 LCP < 1.5s（Cloudflare Pages + 全球 CDN）。
- 异常事件告警触达时间 < 5 分钟。

### 非目标
- 用户账号 / 订阅 / 收藏
- 多语言界面
- 收费

### 依赖的 ADR
- ADR-0010 dev/deploy topology 在此 phase 重新评估是否拆出 Email Worker / WAF Worker 等
- 新增 ADR-0015（待写）：备份与 restore 流程
- 新增 ADR-0016（待写）：监控告警拓扑

## 8. 各 Phase 的工程节奏建议

```text
Phase 0  立基            已用 1 个 work session
Phase 1  MVP             估 6 个 work session（按 mvp-build-phases 6 子阶段各 1）
Phase 2  检索 + 智能化    估 3 个 work session
Phase 3  RAG 问答        估 4 个 work session
Phase 4  产品化          估 5 个 work session
```

每个 phase 完成后：
- 更新 `docs/CURRENT_STATE.md`（仅当主流程或默认行为变化时）
- 在 `docs/plans/` 下追加该 phase 的复盘短文（可选）
- 在 `docs/adr/` 下补该 phase 产生的 ADR

## 9. 风险与取舍

- **Phase 2 话题聚类的 LLM 介入面扩张**：LLM 介入加深、token 成本上升、引入幻觉风险。取舍：拉开 LLM_ENABLED 开关 → Phase 2 要新增 ADR 把"聚合缓存"路径设计清楚，避免回流污染 D1。
- **Phase 3 Vectorize 数据时效**：新 Item 入 D1 后需异步进 Vectorize，存在时间窗口用户问题答不到。取舍：cron Worker 末尾加 "embed 增量"任务，复用 enrich_cache 同模式。
- **Phase 4 静态导出 vs ISR**：`output: export` 与 Cloudflare Pages 静态资产绑定，引入 ISR 需迁到 Pages Functions。取舍：先把首页 + 时间线改为 ISR，公司页继续静态。
- **跨 phase 节奏不强制连续**：每个 phase 独立可交付，之间可有任意长间隔、不动现网。

## 10. Phase 间接口稳定性

| 接口 / 字段 | 稳定性来源 | 跨 phase 是否变更 |
|---|---|---|
| Item schema | ADR-0002 | Phase 2 可能加 `cluster_id` 派生字段；不破原字段 |
| Company Registry | ADR-0001 | 不变；Phase 2 加 LLM 月度 notes 提议 |
| read API 5 端点 | PRD impl decisions | Phase 3 新增 `/ask`；不破原 5 端点 |
| D1 schema | `worker/sync/schema.sql` | Phase 2 加 `clusters`/`item_clusters` 表；Phase 3 加 Vectorize binding（不破 D1） |
| Worker env vars | ADR-0006 | 各 phase 按需要新增，不破现 vars |
| Company 归属两段 | ADR-0003 + ADR-0009 | 不变；Phase 2 在此之上加话题聚类层 |

## 11. 何时更新 CURRENT_STATE

- Phase 0 完成 → 已完成（CURRENT_STATE 第 23 行"当前阶段"段为 reflect"Phase 0 完成、Phase 1 进行中"）
- Phase 1 完成 → 更新"当前阶段"、"主流程关键事实"（cron 已运行）
- Phase 2/3/4 完成 → 同样按主流程变更更新

本文描述的 phase 划分是产品工程路线图，落地由各 phase 单独的子计划接管（MVP 已有 `mvp-build-phases.md`；Phase 2-4 启动时再补子计划文档）。本文不替代子计划。
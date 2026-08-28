# 产品工程落地大纲

## 1. 背景

`docs/prd/PRD.md` 与 14 枚 ADR 已锁定 MVP 范围与架构取舍（2026-08-28 经 ADR-0013 / 0014 做 v1 本地优先裁剪：D1 单存储、手动同步、部署后移、单段归属、砍 RAG），`docs/plans/mvp-build-phases.md` 已把 MVP 内部的 0-5 阶段 + 可选部署日铺开。本文站在产品宏观视角，规划从 MVP 到后续迭代的 phase 划分、各 phase 出口标准、依赖的 ADR / 子计划。

本文与 `mvp-build-phases.md` 的关系：mvp-build-phases 描述 Phase 1 内部的子阶段，本文描述更高一级的产品 phase。

## 2. 总览 phase

```text
Phase 0  立基          [已完成]      docs 体系 + 基础 schema/wrangler/next.config 已就位
Phase 1  MVP           [进行中]      四视图 + 本地手动同步 + D1 六表；可选部署日，详见 mvp-build-phases.md
Phase 2  检索          [未启动]      全文检索（D1 FTS5 或客户端 flexsearch）+ 公司活动热度图（可选）
Phase 3  RAG 问答      [已裁剪]      ADR-0014；语义检索需求由 Phase 2 全文检索承接，重启需新 ADR
Phase 4  产品化        [未启动]      部署日之后的监控、备份、多用户防护、性能优化
```

## 3. Phase 0 · 立基（已完成）

### 目标
- 决策固化：术语、PRD、ADR。
- 基础设施就位：`wrangler.jsonc` / `.dev.vars` / `next.config.ts` rewrites / `src/lib/schema.ts` / `src/lib/matchCompanies.ts` / `worker/sync/schema.sql` / `data/companies.yaml`。
- 文档体系分层：AGENTS.md / CLAUDE.md / CONTEXT.md / docs/CURRENT_STATE.md / docs/FRONTEND_DESIGN.md (stub) / docs/plans/ / docs/adr/ / docs/prd/PRD.md。

### 出口标准（已满足）
- git 分支已建并完成首条 commit；全部 ADR 落地、互引用一致。

### 非目标
- 任何可运行功能（不是 MVP，仅做地基）。

## 4. Phase 1 · MVP（进行中）

### 目标
让"按事件流 + 公司"重新整理的查阅工具**本地可用**，`npm run sync` 手动增量同步 daily.juya.uk 每日新期；部署为可选收尾（阶段 6 部署日）。

### 包含
- 4 路由（`/`、`/stream`、`/company`、`/company/[id]`）+ 顶部 Nav 三联 + 共用 Header（首页 v1 维持直连 daily.juya.uk）
- D1 六表（含 `sources` 原文表，替代 R2）+ read API 5 端点
- 共享 sync 模块：本地 `npm run sync` 手动增量；Worker `scheduled` 入口预留（部署日启用 cron）
- Company Registry 31 家种子 + 确定性白名单匹配（单段、无 LLM，ADR-0014）
- 4 个空态 UI
- Vitest 覆盖纯函数（parseMarkdown / matchCompanies）

### 详细子阶段
完全由 `docs/plans/mvp-build-phases.md` 接管：阶段 0 清债、阶段 1 解析器、阶段 2 本地 D1 回填、阶段 3 确定性匹配、阶段 4 read API + 三视图、阶段 5 手动同步、阶段 6（可选）部署日。本文不重复。

### 出口标准
- 本地 `npm run dev` + `wrangler dev` 双进程下四视图切换顺畅。
- `npm run sync` 幂等增量同步跑通，`sync_log` 可查。
- 抽样企业（Anthropic / OpenAI 及其关联公司）的档案头五块字段齐全。
- Vitest 全绿、typecheck 全绿。
- （执行部署日后追加：公网域名可访问、cron 自动落新期、抽样多家 Item 的 role 回填正确。）

### 非目标
- 全文检索 / 语义检索（Phase 2）
- 话题聚类 / 公司简介自动生成（已裁剪，ADR-0014）
- 多用户 / 监控 / 备份（Phase 4）
- cron 自动同步、R2、Pages 部署（阶段 6 部署日，可选）

### 依赖的 ADR
ADR-0001 至 ADR-0014 全部。

## 5. Phase 2 · 检索（未启动）

### 目标
让"跨期找事件"从滚动浏览升级为主动查询。

### 包含
- **全文检索**：D1 FTS5 或客户端 flexsearch（开工前先 spike 验证 FTS5 在 D1 的支持度，ADR-0014），索引 `title + summary + bodyMd`，顶部搜索框、命中高亮、跨期定位。
- **公司活动热度图**（可选）：公司页底部按天事件数的 SVG 自绘热度图（≤ 100 行，无第三方图表库）。

### 出口标准
- 搜索"Kimi 上市"能高亮返回所有标题/摘要/正文命中 Item，跨期定位无遗漏。
- （若做热度图）公司页活动热度图正确显示，无第三方 chart 依赖。

### 非目标
- 语义跨公司聚类（行业主题 graph）
- LLM 话题聚类 / 公司简介自动生成（已裁剪，远期可选，ADR-0014）
- 自动告警 / 订阅推送
- 语义检索 / RAG（已裁剪，ADR-0014）

### 依赖的 ADR
- ADR-0001 / 0002（白名单与 Item schema 不变，FTS 影子表不破原字段）
- ADR-0014（检索承接方案）
- 新增 ADR-0015（待写）：全文检索选型（FTS5 vs flexsearch）与索引维护策略

## 6. Phase 3 · RAG 问答（已裁剪）

原计划的 Vectorize 索引 + `/ask` 视图 + 流式回答 + 配额限流**整体裁剪**（ADR-0014，2026-08-28）：数千条 Item 的语料量级下，全文检索（Phase 2）已能覆盖主要查询诉求，向量检索的子系统成本（embedding 流水线、检索时效窗口、配额限流）不成立。

若未来数据量或产品需求升级到需要语义检索，重启本 phase 时需新写 ADR：Vectorize index schema、embedding 选型、检索后回 join D1 的契约、配额与限流。

## 7. Phase 4 · 产品化（未启动）

### 目标
从"个人本地工具"延伸到"多用户查阅产品"，加固运维与稳定性。**以阶段 6 部署日完成为前置。**

### 包含
- **多用户基础设施**：无账号系统（仍匿名），但加配额、速率限制、被滥用防护（Cloudflare WAF / Turnstile）。
- **监控与告警**：cron 失败 / D1 不可达 / 拉取失败时通过 Email Routing 或 Discord webhook 告警（避免 `sync_log` 黑洞）。
- **备份策略**：D1 定期 `wrangler d1 export` 到 R2 作 daily snapshot（`sources` 表即原文备份；是否另迁 R2 归档在部署日评估）。
- **性能优化**：read API 加 Edge Cache Reserve、首页/事件流 ISR 评估（重新审视 `output: export` 静态导出是否仍合理）。
- **可观测性**：Workers Logs 接 Cloudflare Logpush，Item 入库延迟、enrich 回填成功率、cron 频率可视化。

### 出口标准
- 监控 dashboard 显示最近 7 天 cron 成功率 ≥ 99%、enrich 失败可追溯。
- D1 每日 snapshot 在 R2 上可见、人工 restore 测试通过。
- 首页 LCP < 1.5s（Cloudflare Pages + 全球 CDN）。
- 异常事件告警触达时间 < 5 分钟。

### 非目标
- 用户账号 / 订阅 / 收藏
- 多语言界面
- 收费

### 依赖的 ADR
- ADR-0010 / 0013（部署拓扑）在此 phase 重新评估是否拆出告警 Worker 等
- 新增 ADR-0016（待写）：备份与 restore 流程
- 新增 ADR-0017（待写）：监控告警拓扑

## 8. 各 Phase 的工程节奏建议

```text
Phase 0  立基            已用 1 个 work session
Phase 1  MVP             估 6 个 work session（阶段 0-5 各 1）+ 可选 1 个部署日
Phase 2  检索            估 1-2 个 work session
Phase 4  产品化          估 4 个 work session
```

每个 phase 完成后：
- 更新 `docs/CURRENT_STATE.md`（仅当主流程或默认行为变化时）
- 在 `docs/plans/` 下追加该 phase 的复盘短文（可选）
- 在 `docs/adr/` 下补该 phase 产生的 ADR

## 9. 风险与取舍

- **D1 对 FTS5 的支持度未验证**：Phase 2 开工前先做 spike；不支持则降级客户端 flexsearch 索引（零后端、构建期生成索引文件，代价是索引随数据更新需重建）。
- **v1 口径分裂（首页实时源 vs D1）**：新期在首页与三视图的落地时间可能不一致。ACCEPT：v1 本地工具场景可接受，部署日统一（ADR-0013）。
- **enrich 回填的 LLM 成本**：后移到部署日一次性批量 + `MAX_LLM_PER_RUN` 限流，长期增量成本可控（多数 Item 零 LLM 调用）。
- **wrangler 本地模拟与生产 D1 的行为差异**：MVP 查询均为简单 SQL，风险低；部署日首次 `--remote` 联调时抽查对账。
- **跨 phase 节奏不强制连续**：每个 phase 独立可交付，之间可有任意长间隔、不动现网。

## 10. Phase 间接口稳定性

| 接口 / 字段 | 稳定性来源 | 跨 phase 是否变更 |
|---|---|---|
| Item schema | ADR-0002 | 不破原字段；Phase 2 可能加 FTS 影子表 |
| Company Registry | ADR-0001 | 不变；LLM 提议流程部署日随 enrich 回填启用 |
| read API 5 端点 | PRD impl decisions | 不破原 5 端点；Phase 2 可能新增搜索端点 |
| D1 schema | `worker/sync/schema.sql` | Phase 1 阶段 2 增 `sources`（六表，ADR-0013）；Phase 2 加 FTS 影子表 |
| Worker env vars | ADR-0006 | 各 phase 按需要新增，不破现 vars；LLM/R2 参数部署日生效（ADR-0013/0014） |
| Company 归属 | ADR-0001 + 0003 段一 + ADR-0014 | v1 单段确定性、role=NULL；role 由部署日后 enrich 回填补齐 |

## 11. 何时更新 CURRENT_STATE

- Phase 1 各子阶段完成 → 按 `mvp-build-phases.md` 第 10 节的触发点更新
- Phase 2/4 完成 → 同样按主流程变更更新

本文描述的 phase 划分是产品工程路线图，落地由各 phase 单独的子计划接管（MVP 已有 `mvp-build-phases.md`；Phase 2/4 启动时再补子计划文档）。本文不替代子计划。

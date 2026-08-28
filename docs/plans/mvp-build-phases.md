# MVP 分阶段构建计划

## 1. 背景

14 枚 ADR + 1 份 PRD（30 条 user stories）已固化（2026-08-28 经 ADR-0013 / 0014 做 v1 本地优先裁剪），但代码尚未大规模落地。需要一份明确的分阶段执行计划，让后续 coding agent 在新会话中按阶段推进、每阶段可独立验证，避免一上来就跨多个 ADR 的大爆炸式实现。本计划同时适配 goal 模式长程无人值守推进：**阶段 0-5 的全部验证都在本地闭环、零 Cloudflare 登录**，人在环操作集中到可选的阶段 6「部署日」。

## 2. 目标

- 把 MVP 工作切成 6 个本地阶段 + 1 个可选部署日，每个阶段有明确入口与验证方式。
- 每阶段产出的代码可独立 review、可独立验证，不依赖后续阶段。
- 历史回填路径与增量同步路径分离，避免相互污染。

## 3. 非目标

- 不纳入 RAG / Vectorize / 语义检索（已裁剪，ADR-0014）。
- 不纳入 LLM enrich 同步关键路径（后置为部署日后离线回填，ADR-0014）。
- 不纳入 v1 部署动作（cron / Pages / R2 / 首页迁移，集中到阶段 6 部署日，ADR-0013）。
- 不纳入前端 `docs/FRONTEND_DESIGN.md`（用户已明确暂缓）。
- 不纳入告警系统、用户账号、多语言界面。
- 不重写已能复用的旧前端组件（Header / DatePicker / ThemeToggle / ArticleView / DailyPage）。

## 4. 当前约束

- v1 本地优先：D1 用 wrangler 默认本地模拟（`--local`），全程零 Cloudflare 登录；`wrangler dev --remote` 仅部署日联调（ADR-0013）。
- 唯一存储引擎为 D1 六张表（含 `sources` 原文表），不引入 R2（ADR-0013）。
- v1 同步为手动 `npm run sync`；Worker `scheduled` 入口留一行挂载，部署日启用 cron 才生效（ADR-0013）。
- v1 归属只跑确定性段一，多家并列 role=NULL；无任何 LLM 调用（ADR-0014）。
- `data/companies.yaml` 是白名单唯一真相源，经 sync 模块幂等 upsert 进 D1，不手动改 D1（ADR-0001）。
- LLM 相关参数（`LLM_API_BASE` / `LLM_API_KEY` 等）部署日才生效（ADR-0006 + ADR-0014）；密钥走 secret / `.env`，不入 git。

## 5. 方案概述

按"清债 → 解析 → 回填 → 匹配 → read API → 手动同步 →（部署日）"的拓扑顺序展开，前端新视图与 read API 同阶段落地，避免出现没有 read API 的前端或没有前端的 read API。阶段之间允许并行（阶段 1 测试与其他阶段写代码可不冲突），但每个阶段内部完成顺序固定。

## 6. 实现拆分

### 阶段 0 — 清债

- 删 `globals.css:129` `--botanical-gold*` 死变量与 `.site-badge` 死代码。
- 修 `README.md`：删旧 GitHub 源描述、对齐 v1 本地优先的开发/运行方式、对齐 `next.config.ts` 已删 `basePath`。
- 加 `typecheck` script 与最简 eslint 配置（tsconfig 已是 strict）。
- 新增 GitHub Actions workflow：CI 跑 typecheck + test（无部署 step；部署日在阶段 6 另行处理）。
- 改 `src/lib/github.ts` → `src/lib/juya.ts`：保留 `parseMarkdown` 纯函数（将在阶段 1 升级），删除旧 fetch 链路。注意：首页 v1 仍直连 daily.juya.uk（ADR-0013），旧 fetch 链路的删除以"不破坏首页现状渲染"为界，必要时保留首页最小 fetch 并加注释标记部署日迁移。

**验证**：`npm run build` 产出 `out/`；`npm run typecheck` 无错；首页加载正常。

### 阶段 1 — 解析器重构 + 类型对齐 + fixtures

- 升级 `parseMarkdown`：在已拆概览分类基础上，输出完整 `Item[]` 结构（含 tag / sequenceInt / category / title / primaryLink / summary / bodyMd / relatedLinks / enrichState=pending）。
- 把 `parseMarkdown` 从前端纯函数下沉到 `worker/sync/parse.ts`（首页渲染仍用旧轻量解析，不再依赖此函数）。
- 抽样真实日报 md 存入 `worker/sync/fixtures/`，作为 Vitest 快照与边界 case 测试的语料。
- Vitest：`parseMarkdown` 快照 + 边界 case 单测（无主链接、缺 #N、缺 `>` 摘要、缺相关链接块）。

**验证**：`npm test parse` 通过；`npm run build` 产出 `out/`；`npm run typecheck` 无错。

### 阶段 2 — 本地 D1 建表 + 全量回填

- `worker/sync/schema.sql` 增补 `sources` 表（`date` PK + markdown），六表齐备；`wrangler d1 execute` 本地建表。
- 写本地 `scripts/backfill.ts`：扫 archive 全量 → fetch markdown → 写 `sources` → parseMarkdown → upsert `items`（暂不写 item_companies）。全程连本地模拟 D1，零登录。
- 把 `data/companies.yaml` 编译进 Worker 用 TS module（`worker/registry.ts` 构建时 import yaml），运行时幂等 upsert D1 `companies` 表。
- 跑 `npm run backfill` 完成全量历史 items 入库。

**验证**：D1 查 `select count(*) from items` 与 archive 期数一致；`sources` 行数与期数一致；抽样几天 Item 字段完整。

### 阶段 3 — 白名单确定性匹配（单段，无 LLM）

- 在 `worker/sync/match.ts` 引入 `matchCompanies` 纯函数（已写）：
  - 从 D1 `companies` 读配置，跑段一确定性匹配，写 `item_companies` 关联（**role 全部 NULL**，含多家并列）。
  - `|S| = 0` 标 `enrich_state=missing_owner`；`|S| ≥ 1` 标 `ok`。
- Vitest：白名单 alias 命中、正则/字面量混合、同公司多别名去重、retired 公司不命中。
- LLM enrich 段（ADR-0009）与 `companies-pending.yaml` 流程**不在本阶段**，随部署日回填落地。

**验证**：抽样单家 / 多家 / 零命中 Item 在 D1 中关联正确（多家并列、role 均为 NULL）；单测全绿。

### 阶段 4 — read API Worker + 前端新增三视图

- `worker/api/` 写 read API：
  - `GET /api/daily/latest` `GET /api/daily/:date`：从 `sources` 表读 md 返回 + parsedOverview。
  - `GET /api/items?company=&category=&from=&to=&before_date=&limit=`：**按期分页**（`before_date` 更早 N 期），**不返回 body_md**。
  - `GET /api/companies` `GET /api/companies/:id`：含档案头五块（ADR-0007）。
  - 60s `caches.default` 缓存；统一 `{error:{code,message}}`。
- 前端：
  - 新增 `src/app/stream/page.tsx` + `StreamView` 组件（按天分组 + facet 筛选 + 卡片字段；多家徽章并列同尺寸）。
  - 新增 `src/app/company/page.tsx` + `CompanyIndex` 组件。
  - 新增 `src/app/company/[id]/page.tsx` + `CompanyProfile` 组件（档案头五块 + Item 倒序列表，差异渲染见 PRD）。
  - 新增全局 Header Nav 三联（"日报 | 事件流 | 公司"），三视图共用。
  - **首页 `/` 不动**（继续直连 daily.juya.uk，ADR-0013）。
  - 4 个空态组件（骨架 + 空筛选提示 + 404 + fetch 失败重试）。
- Vitest：对 read API 的 SQL / 分页参数构造逻辑做单测（不需要真 D1，测 helper 函数）。

**验证**：`wrangler dev`（本地模拟）访问 `/api/items` 看响应；前端 `npm run dev` 通过 rewrites 看四视图切换顺畅；抽样公司页档案头五块字段齐全；`before_date` 翻页结果正确。

### 阶段 5 — `npm run sync` 手动增量同步

- 抽取共享 sync 模块（`worker/sync/`）：查 `max(items.date)` + `SYNC_LOOKBACK_DAYS` 决定拉新期范围 → 走阶段 2/3 的 parse → match 流水线 → 单期失败独立 try-catch + 写 `sync_log`。
- package.json 加 `sync` script（本地 Node/wrangler 客户端执行，连本地模拟 D1）。
- Worker `scheduled` 入口留一行挂载同一模块（v1 不生效；`triggers.crons` 留空，部署日启用）。

**验证**：连续跑两次 `npm run sync` 第二次零写入（幂等）；某期故意 fetch 404 时 `sync_log` 出现 fetch_failed 且后续期仍同步成功；`npm test` 全绿。

### 阶段 6（可选）— 部署日

集中所有人在环操作，一次会话完成（ADR-0013 / 0014）：

- Cloudflare 登录；替换 `wrangler.jsonc` 的 `database_id` 占位符；建生产 D1 并跑 schema；按需评估 R2（从 `sources` 导出）。
- `wrangler deploy` 上线 Worker：启用 `triggers.crons`（`["0,30 0,1,2 * * *"]`）；首次手动触发验证。
- Cloudflare Pages 部署前端 + `/api/*` 同域代理（Pages Functions 或 custom domain）。
- 首页 `/` 从直连 daily.juya.uk 迁移到 `/api/daily/:date`，统一口径（PRD user story #30）。
- enrich 离线回填首次运行：批量跑 ADR-0009 的 LLM 任务，写 `item_companies.role` + `enrich_cache`；启用 `companies-pending.yaml` 提议流程；补测 enrichLLM prompt 组装与启发式 role 单测（ADR-0011 两行后置测试）。

**验证**：公网域名可访问、四视图顺畅；cron 触发后新期自动入库、`sync_log` 出现 `status=ok`；抽样多家 Item 的 role 判定在 D1 中正确且前端徽章呈现主次。

## 7. 数据结构 / 接口 / 状态变化

- D1 schema 变化：阶段 2 整体建表一次（六表），后续阶段不增表；Phase 2 全文检索若走 FTS5 会加影子表（另行 ADR）。
- 前端路由变化：阶段 4 新增三视图；首页 fetch 路径切换推迟到阶段 6。
- API 契约：阶段 4 钉死 5 条 read API 的 query / response 形状，分页为 `before_date` 按期分页（ADR-0014），详见 `docs/prd/PRD.md` Implementation Decisions。
- Item `enrich_state`：阶段 2 入库时为 `pending`；阶段 3 完成匹配后变 `ok` 或 `missing_owner`（v1 无 LLM 段，`pending` 仅残留于解析残缺 Item）。

## 8. 验证方式

- 每阶段独立 `npm test <path>` 跑针对性 Vitest。
- 阶段 2 / 3 用 `wrangler d1 execute --local --command="select ..."` 人肉核验数据。
- 阶段 4 / 5 用浏览器 devtools 看 `/api/*` 响应 + 前端 4 视图切换。
- 真实 LLM 调用是高成本检查，v1 阶段全程不发生；首次真实调用在阶段 6 enrich 回填，作 sanity check 不作默认验证。

## 9. 风险与取舍

- **v1 口径分裂**：首页直连 daily.juya.uk 实时源，三视图读 D1，新期落地时间可能不同步。ACCEPT：v1 本地工具场景可接受，部署日统一（ADR-0013）；"看原期"锚点不受影响。
- **enrich 后置的展示代价**：多家徽章 v1 无主次、无 Role 提示。ACCEPT：确定性匹配保证"涉及哪些公司"正确，主次为视觉增强，部署日回填后启用。
- **阶段 4 前端与 read API 绑死**：同阶段落地，不存在读不到 API 的中间态；若 read API 延期，前端进度同样卡住——绑死是必要取舍。
- **同步失败重试**：手动 sync 失败重跑即可（幂等）；部署日后 cron 失败依赖下次自然重试，MVP 不做 retry queue 与告警；daily.juya.uk 长时间不可达时 `sync_log` 堆积 fetch_failed 行，需人工周知。
- **wrangler 本地模拟与生产行为差异**：D1 本地模拟（miniflare）与生产 D1 在边缘 case 上可能有差异。ACCEPT：MVP 查询均为简单 SQL；部署日首次 `--remote` 联调时抽查对账。

## 10. 何时更新 CURRENT_STATE

仅当本方案已落地并改变主流程、默认行为、canonical 字段、关键入口或默认验证方式时，才更新 `docs/CURRENT_STATE.md`。具体而言：

- 阶段 0 完成 → 更新"当前可维护性热点"段（移除 botanical / README 死债项）。
- 阶段 1 完成 → 更新"关键文件地图"加 `worker/sync/parse.ts` 与 `worker/sync/fixtures/`。
- 阶段 2 完成 → 更新"主流程关键事实"、加"D1 六表已建并回填历史（本地模拟）"一条。
- 阶段 3 完成 → 更新"重要运行事实"补匹配结果统计（单家 / 多家 / 零命中占比）。
- 阶段 4 完成 → 更新"当前 UI 结构"（四视图就位）、"前端取数"段（三新视图走 `/api/*`，首页仍直连）。
- 阶段 5 完成 → 更新"主流程关键事实"第 1 条从"待实现"变为"`npm run sync` 已可用"。
- 阶段 6 完成 → 更新"当前架构"（生产部署 / cron 已运行）、口径统一与 enrich 回填事实。

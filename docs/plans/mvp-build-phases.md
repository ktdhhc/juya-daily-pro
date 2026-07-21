# MVP 分阶段构建计划

## 1. 背景

11 枚 ADR + 1 份 PRD（30 条 user stories）已固化，但代码尚未大规模落地。需要一份明确的分阶段执行计划，让后续 coding agent 在新会话中按阶段推进、每阶段可独立验证，避免一上来就跨多个 ADR 的大爆炸式实现。

## 2. 目标

- 把 MVP 工作切成 6 个阶段，每个阶段有明确入口与验证方式。
- 每阶段产出的代码可独立 review、可独立验证，不依赖后续阶段。
- 历史回填路径与增量同步路径分离，避免相互污染。

## 3. 非目标

- 不纳入 RAG / Vectorize / 全文 RAG 问答页（二期）。
- 不纳入前端 `docs/FRONTEND_DESIGN.md`（用户已明确暂缓）。
- 不纳入告警系统、用户账号、多语言界面。
- 不重写已能复用的旧前端组件（Header / DatePicker / ThemeToggle / ArticleView / DailyPage）。

## 4. 当前约束

- 部署目标是 Cloudflare Pages + 独立 Worker，已通过 `wrangler.jsonc` 与 `next.config.ts` 配置形态落地（ADR-0010）。
- Worker 单次调用最长 ~30s CPU 时间，全量回填几十天历史**不能**在 Worker 跑，必须走本地脚本。
- LLM 调用必须可通过 `OPENAI_API_BASE` / `OPENAI_API_KEY` 切换 provider（ADR-0006）。
- `data/companies.yaml` 修改后不能手动同步 D1（ADR-0001 v2 D 变体）。

## 5. 方案概述

按"清债 → 解析 → 回填 → enrich → read API → cron"的拓扑顺序展开，前端新视图与 read API 同阶段落地，避免出现没有 read API 的前端或没有前端的 read API。阶段之间允许并行（阶段 1 测试与其他阶段写代码可不冲突），但每个阶段内部完成顺序固定。

## 6. 实现拆分

### 阶段 0 — 清债 + Cloudflare Pages 切换

- 删 `globals.css:129` `--botanical-gold*` 死变量与 `.site-badge` 死代码。
- 修 `README.md`：删旧 GitHub 源描述、改 Cloudflare Pages 部署姿势、对齐 `next.config.ts` 已删 `basePath`。
- 加 `tsconfig` 已是 strict，需要再加 `typecheck` script 与最简 eslint 配置。
- 新增 GitHub Actions workflow：CI 跑 typecheck + test，部署 step 暂留占位（等 Cloudflare 部署 secret 配齐后启用）。
- 改 `src/lib/github.ts` → `src/lib/juya.ts`：保留 `parseMarkdown` 纯函数（将在阶段 1 升级），删除旧 fetch 链路（前端将不再直读 daily.juya.uk）。

**验证**：`npm run build` 产出 `out/`；`npm run typecheck` 无错；旧 daily 阅读页（仍走 mock / 占位 fetch）可加载。

### 阶段 1 — 解析器重构 + 类型对齐 + R2 历史回填脚本

- 升级 `parseMarkdown`：在已拆概览分类基础上，输出完整 `Item[]` 结构（含 tag / category / title / primaryLink / summary / bodyMd / relatedLinks / enrichState=pending）。
- 把 `parseMarkdown` 从前端纯函数下沉到 `worker/sync/parse.ts`（前端只读，不再调用此函数）。
- 写本地 `scripts/backfill.ts`（用 wynd/wrangler 客户端层）：扫 archive 全量 → fetch markdown → 写 R2 `daily/<date>.md` →（先不解析入 D1，这一步只做 R2 归档）。
- Vitest：`parseMarkdown` 抽样真实日报 md 做快照 + 边界 case 单测。

**验证**：`npm test parse` 通过；`scripts/backfill.ts --dry-run` 输出预期数量；`wrangler r2 object list` 看到 archive 全量。

### 阶段 2 — D1 建表 + 全量回填

- 本地用 `wrangler d1 execute` 跑 `worker/sync/schema.sql`，建五张表。
- 在 `scripts/backfill.ts` 增量执行回填：从 R2 读每篇 md → parseMarkdown → upsert D1 `items`（暂不写 item_companies）。
- 同步把 `data/companies.yaml` 编进 Worker 用 TS module（worker/registry.ts 由 yaml 在构建时 import 编译，运行时 upsert D1 `companies` 表）。
- 跑 `npm run backfill` 完成全量历史 items 入库。

**验证**：D1 查 `select count(*) from items` 与 archive 期数一致；抽样几天 Item 字段完整。

### 阶段 3 — 白名单匹配 + LLM enrich

- 在 `worker/sync/match.ts` 引入 `matchCompanies` 纯函数（已写）：
  - 从 D1 `companies` 读配置，跑段一确定性匹配，写 `item_companies` 关联。
  - `|S| ≤ 1` 时直接 upsert、`|S| = ∅` 标 `enrich_state=missing_owner`。
- 在 `worker/sync/enrich.ts` 写段二 LLM 调用：
  - 仅当 item 命中 ≥2 家白名单公司时触发。
  - Prompt 只输出 `{primary_company_id, reason}`，存 enrich_cache；partner/subject 由启发式补。
  - `MAX_LLM_PER_RUN` 限流；`LLM_ENABLED=false` 时降级为多家无 role 关联。
- 启发式 role 补单测（title "与/和" → partner、仅 body 提及 → subject）。
- 跑脚本对全量历史 items 补一次 enrich（批量调 LLM 但受限），再切 cron 增量模式。
- `data/companies-pending.yaml` 与 LLM prompt 输出格式敲定。

**验证**：抽样一条多家归属 item 的 enrich 结果在 D1 中正确；enrich_cache 行数与触发数一致；启发式单测全绿。

### 阶段 4 — read API Worker + 前端新增三视图

- `worker/api/` 写 read API：
  - `GET /api/daily/latest` `GET /api/daily/:date`：从 R2 读 md 返回 + parsedOverview。
  - `GET /api/items?company=&category=&from=&to=&cursor=`：cursor 分页，**不返回 body_md**。
  - `GET /api/companies` `GET /api/companies/:id`：含档案头五块（ADR-0007）。
  - 60s `caches.default` 缓存；统一 `{error:{code,message}}`。
- 前端：
  - 新增 `src/app/stream/page.tsx` + `StreamView` 组件（按天分组 + facet 筛选 + 1-11 字段全卡片）。
  - 新增 `src/app/company/page.tsx` + `CompanyIndex` 组件。
  - 新增 `src/app/company/[id]/page.tsx` + `CompanyProfile` 组件（档案头五块 + Item 倒序列表）。
  - 新增全局 Header Nav 三联（"日期 | 事件流 | 公司"），三视图共用。
  - 首页 `/` 改 fetch `/api/daily/:date`（最坏滞后 30 分钟，无 client fallback）。
  - 4 个空态组件（骨架 + 空筛选提示 + 404 + fetch 失败重试）。
- Vitest：对 read API 的 SQL 构造逻辑做单测（不需要真 D1，测 helper 函数）。

**验证**：`wrangler dev --remote` 本地访问 `/api/items` 看响应；前端 `npm run dev` 通过 rewrites 看四视图切换顺畅；抽样公司页档案头五块字段齐全。

### 阶段 5 — cron Worker 自动同步

- 在 `worker/sync/cron.ts` 接入 `scheduled` 入口：
  - 查 `max(items.date) + SYNC_LOOKBACK_DAYS` 决定拉新期范围。
  - 走阶段 3 的 parse → match → enrich 流水线。
  - 单期失败独立 try-catch + 写 sync_log。
  - `enrich_cache` 命中跳过 LLM。
- `wrangler deploy` 上线 cron trigger。
- 第一次手动触发（`wrangler trigger` 或 curl admin route）验生产或 staging 环境。

**验证**：cron 触发后下一期新 archive 出现时 D1 自动增量；sync_log 表里能看到至少一行 status=ok；某期故意 fetch 404 时 sync_log 出现 fetch_failed 且后续期仍同步成功。

## 7. 数据结构 / 接口 / 状态变化

- D1 schema 变化：阶段 2 整体建表一次，后续阶段不增表（除非 RAG 二期加 Vectorize 绑定）。
- 前端路由变化：阶段 4 新增三视图、首页 fetch 路径切换。
- API 契约：阶段 4 钉死 5 条 read API 的 query / response 形状，详见 `docs/prd/PRD.md` Implementation Decisions。
- Item `enrich_state`：阶段 2 入库时为 `pending`；阶段 3 / 阶段 5 完成匹配后变 `ok` 或 `missing_owner`。

## 8. 验证方式

- 每阶段独立 `npm test <path>` 跑针对性 Vitest。
- 阶段 2 / 3 用 `wrangler d1 execute --command="select ..."` 人肉核验数据。
- 阶段 4 / 5 用浏览器 devtools 看 `/api/*` 响应 + 前端 4 视图切换。
- 真实 LLM 调用是高成本检查，仅在阶段 3 末与阶段 5 末各跑一次，作 sanity check 不作默认验证。

## 9. 风险与取舍

- **阶段 3 LLM 调用成本**：全量历史 enrich 一次需调多次 LLM（按多家归属 item 数估）。受 `MAX_LLM_PER_RUN=20` 限流后须多次跑或循环跑。ACCEPT：阶段 3 一次性补完，长期成本可控。
- **阶段 4 前端无 read API 时的 mock 体验**：阶段 4 实际是 read API + 前端同阶段落地，不存在读不到 API 的中间态。但若 read API 实现延期，前端进度也卡住——同阶段绑死是必要的取舍。
- **阶段 5 cron 失败重试**：单次 cron 失败依赖下次 cron 自然重试，MVP 不做 retry queue 与告警。若 daily.juya.uk 长时间不可达，sync_log 会堆积 fetch_failed 行，需人工周知。
- **首页 `/` 与事件流/公司页数据口径**：MVP 三视图全部走 Worker read API，口径一致；无 cron 时首页最坏滞后 30 分钟（cron 周期内）或更长（cron 故障），均统一从 D1 读，不会出现首页是新期且公司页缺该期的分裂状态。

## 10. 何时更新 CURRENT_STATE

仅当本方案已落地并改变主流程、默认行为、canonical 字段、关键入口或默认验证方式时，才更新 `docs/CURRENT_STATE.md`。具体而言：

- 阶段 0 完成 → 更新"当前可维护性热点"段（移除 botanical / README 死债项）、移除架构里"gh-pages 痕迹"标记。
- 阶段 1 完成 → 更新"关键文件地图"加 `worker/sync/parse.ts` 与 `scripts/backfill.ts`。
- 阶段 2 完成 → 更新"主流程关键事实"、加 "D1 五张表已建并回填历史" 一条。
- 阶段 3 完成 → 更新"重要运行事实"补 LLM enrich 真实跑通数据。
- 阶段 4 完成 → 更新"当前 UI 结构"（四视图就位）、"前端取数"段（统一走 `/api/*`）。
- 阶段 5 完成 → 更新"主流程关键事实"第 1 条从"待实现"变为"生产已运行"。
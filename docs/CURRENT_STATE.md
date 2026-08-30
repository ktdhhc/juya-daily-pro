# CURRENT_STATE

## 维护规则

- 防止过度膨胀规则：本文档一般保持在 100-200 行，最多不超过 250 行。写入时先判断是否值得记录、是否可以和已有内容合并、是否应删除旧内容。
- 应写什么：当前仍然有效且会直接影响开发判断的默认事实，如主链流程、关键字段、默认运行方式、关键入口文件、默认验证路径。
- 不应写什么：历史过程、讨论痕迹、未落地方案、一次性 workaround、局部实现细节、两周内很可能再次变化的临时约定。
- 更新触发条件：仅当主流程、默认行为、canonical 字段、关键入口文件或默认验证方式发生稳定变化时更新；普通小改、临时调试和未闭环改动不更新。
- 更新方式：本文件只做覆盖式更新，不追加历史；删除已失效事实，保留当前真相。

## 项目一句话说明

把 daily.juya.uk 每日发布的 AI 资讯合集按"事件流 + 公司"两个维度重新整理；本地优先（D1 单存储 + 手动三段制编辑工作流），部署与多用户产品化后移（ADR-0013/0015）。

## 当前阶段

**阶段 0-5（v1 本地 MVP）+ spec06-11 全部完成（2026-08-30）**：read API + `POST /api/sync`（暂存写入、stagedDates 权威口径）+ 角色权限基座（口令制访客/管理员）+ 编辑工作流（同步-解析-入库三段，/review 审核页，已发布缺主次条目可重解析）+ LLM 数据整理（323+2 条多家命中 role 全量回填）+ 数据面板（/dashboard 五段自绘图表、热力图深浅只按当日条数）+ 阅读时间线（/ 左侧刻度轨）+ 搜索联想（/api/search/suggest）与结果页 `<mark>` 高亮。vitest 292 测试 + 双 typecheck + lint 门禁全绿，静态导出 46 页。**下一站部署日（阶段 6，需用户在场）**：Cloudflare 登录 → 替换 `database_id` → 生产 D1 迁移 + backfill → `wrangler deploy` + ADMIN_TOKEN/LLM_API_KEY secret → Pages + /api 同域代理 → 启用 cron（只写暂存不自动发布）。部署清单详见 `handoffs/260829-1242.md` 与 CURRENT_STATE 本文件。

## 范围边界

- 做：三视图（/stream、/company、/company/[id]）+ /review 审核页 + /dashboard 面板 + D1 八表（含 published 暂存列、item_proposals、company_candidates）+ read/parse/review API + 三段制编辑工作流 + 确定性白名单匹配 + LLM 裁决回填。
- 暂不做：RAG / Vectorize / 语义检索 / 话题聚类 / 用户账号多级权限 / 自动发布（publish 恒为人工确认）/ 候选公司自动入册。

## 当前架构

```text
- 后端：Cloudflare Worker——read API（published=1）+ POST /api/sync（暂存）+ POST /api/parse（LLM 解析段）
  + /api/review/*（pending/item/publish）+ /api/admin/ping + /api/stats；requireAdmin 守卫统一 ADMIN_TOKEN
- 前端：Next.js 16 (App Router, output export)；本地 next dev + wrangler dev，部署日 Pages 静态托管
- 持久化：D1（items/sources 带 published 列；companies/item_companies（含 role）/enrich_cache/sync_log/item_proposals/company_candidates）——唯一存储
- LLM：Worker 解析段（/api/parse，MAX_LLM_PER_RUN 限流；已发布缺主次条目可重解析=失败补救通道）与离线脚本（npm run enrich）共用 src/lib/llm/* 纯函数；wrangler.jsonc 的 LLM_API_BASE/LLM_MODEL 必须与实际供应商一致（0830 曾因占位值打错端点 401）
- 关键外部依赖：daily.juya.uk（archive + markdown 源）
```

## 主流程关键事实

1. **三段制编辑工作流（ADR-0015）**：`POST /api/sync` 或同步按钮 → 新数据 **published=0 暂存**（访客不可见，同步段零 LLM；响应含 stagedDates）→ 管理员在 /review 点「解析」→ `POST /api/parse` 对暂存条目 LLM 裁决（多家命中判 primary + deriveRoles 补 partner/subject；missing_owner 三分类出候选公司）→ /review 逐条检查/编辑（PATCH item 重写归属）→ 「确认入库」`POST /api/review/publish` 原子发布（published 0→1 + 应用 proposal + 写 enrich_cache）。upsert 的 DO UPDATE 一律**不含 published**（重同步不翻转状态）。
2. **前端取数**：全部视图走相对路径 `/api/*`（dev 由 next.config rewrites 代理到 wrangler dev :8787）；首页 `/` 仍直连 daily.juya.uk（部署日迁移，ADR-0013）。fetch 统一走 `src/lib/api.ts` 的 apiFetch（本地存有管理口令时自动附 `x-admin-token`）。
3. **白名单闸门**：`data/companies.yaml` 唯一真相源，sync 幂等 upsert D1 companies。候选公司只进 company_candidates 表/companies-pending.yaml，**入册唯一通道是人工改 yaml + `npm run gen:registry`**（Worker 不写 repo 文件）。
4. **归属规则**：段一确定性匹配（0 命中 missing_owner、1 家单归属 role=NULL、多家并列待裁决）→ LLM 裁决回填 role（primary/partner/subject）。存量 323 条已全量回填（primary=323/partner=95/subject=403）；人工纠错 `UPDATE enrich_cache.result` 后 `npm run enrich -- --apply --item=<id>` 零 LLM 重应用。
5. **角色权限**：`requireAdmin(envToken, headerToken)` 纯函数——ADMIN_TOKEN 空=全开放（本地默认）；非空校验 `x-admin-token`。前端口令存 localStorage `juya-admin-token`（src/lib/auth.ts），AdminGate 组件探针 `/api/admin/ping` 验证。

## 不应轻易改动的约定

- `data/companies.yaml` 是 Company Registry 唯一真相源（ADR-0001），手动同步 D1 会引入双写源。
- Item 主键 `YYYYMMDD-N`、保留 `body_md`、`summary` 不二次补全（ADR-0002）。
- 同步段零 LLM（ADR-0014 缩窄版，ADR-0015）；publish 恒为人工确认，不做自动发布。
- 同期同主话题补丁不折叠、跨期同主题也不合并（CONTEXT.md）。
- itemCompaniesUpsertSql 用 `COALESCE(excluded.role, item_companies.role)`——同步传 NULL role **不得清掉** enrich 已写 role（防清摆，spec09）。
- 部署动作（cron / Pages / 首页迁移）集中在部署日（ADR-0013）。

## 当前 UI 结构

- 报头（全站共用）：品牌方印「橘」+ Nav（日报/事件流/公司 + 管理员态「面板」）+ 搜索/同步（仅管理员）icon-btn +「管理/退出管理」文字链 + 「审核·N」链接；AdminGate 口令条复用搜索条交互（fade-up、Esc）。
- `/` 阅读页：直连 daily.juya.uk（部署日迁移），galley 骨架 + 合订本日历。
- `/stream`：facet 栏 + 按天分组条目流；钤印主次语言——主导 20px 实印 / 参与 18px / 提及 16px 描边，tooltip 带角色词（§4.2）。
- `/company`、`/company/[id]`：印章卡片墙 + 档案头五块（不变）。
- `/review`：暂存期列表 + 条目归属编辑（ProposalEditor）+ 候选公司区（CandidatePanel，复制 YAML / 标记）+ PublishBar 确认入库（管理员直访，访客 AdminGate 解锁）。
- `/dashboard`：总览五块 + TrendLine（点跳 /?date=）+ RankBars（分类/公司 Top12 墨条跳转）+ EnrichDonut（环形三段）+ SyncHeatmap（12 周 84 格全渲染，深浅只按当日条数 4 档）——全自绘，零图表库（§4.8）。
- 阅读页时间线（§4.10）：左侧刻度轨（TimelineRail，lg+），hover 显标题、点击落位、scrollspy 高亮当前条目。
- 搜索（§4.11）：报头输入即联想下拉（/api/search/suggest，命中高亮，↑↓/Enter）；/stream 结果页 title/summary `<mark>` 高亮（facets.query 由 loadFirst 回写）。
- 设计契约：`docs/FRONTEND_DESIGN.md`（§4.8 数据面板、§4.10 时间线、§4.11 搜索）；原型 `demo/index.html`。

## 关键文件地图

```text
worker/api/auth.ts             # requireAdmin 纯函数 + 单测（守卫核心，空 env=开放）
worker/api/routes.ts           # 全部 API 路由（sync/ping/stats/review 系列）；Env 含 ADMIN_TOKEN
worker/api/stats.ts            # /api/stats 聚合构造器 + 组装器（published=1 过滤）
worker/api/parse.ts            # /api/parse 圈题 + LLM 编排 + review 端点实现
worker/api/queries.ts          # read API 构造器（全部含 published=1 过滤）
worker/sync/sqlgen.ts          # upsert SQL 生成（staged 语义 / COALESCE role 防清摆）
worker/sync/schema.sql         # 基础六表；增量迁移 scripts/migrate-staging.sql（npm run db:migrate）
src/lib/llm/enrich.ts          # enrich 纯函数（prompt/parse/deriveRoles/parseCachedResult）
src/lib/llm/propose.ts         # propose 三分类纯函数
src/lib/llm/chat.ts            # chatJson（90s 超时+瞬时错误重试）/ runWithLimiter（脚本与 Worker 共享）
scripts/lib/llm.ts             # .env 配置装载（LLM_BASE_URL/MODEL_NAME/LLM_API_KEY，re-export chat）
scripts/enrich.ts              # 存量回填（npm run enrich）+ --apply 人工纠错重应用（零 LLM）
scripts/propose-companies.ts   # 候选公司提议（npm run propose:companies → data/companies-pending.yaml）
src/lib/auth.ts                # 管理口令存取（localStorage juya-admin-token，注入 store 可测）
src/components/common/AdminGate.tsx  # 口令输入条（探针 /api/admin/ping，403 不清空输入）
src/components/review/         # StagedIssueList / ProposalEditor / CandidatePanel / PublishBar
src/components/dashboard/      # chartMath + StatTiles/TrendLine/RankBars/EnrichDonut/SyncHeatmap
src/lib/api.ts                 # 前端契约类型 + apiFetch（自动附 x-admin-token）+ fetchStats/review 封装
docs/adr/0001-0015.md          # 15 枚 ADR（0015 三段制编辑工作流为最新口径）
wrangler.jsonc                 # database_id 仍是占位符（部署日替换）；secrets 必须对象形态
```

## 重要运行事实

- 本地全程零 Cloudflare 登录：D1 走 wrangler 本地模拟（.wrangler/state/，清空即重置 → schema + migrate + backfill 恢复）。
- **wrangler secrets 声明模式下 `.dev.vars` 未声明键不注入 env**（实测）——本地守卫验证一律 `npx wrangler dev --var ADMIN_TOKEN:xxx`；8787 常驻开放态。
- LLM：`.env`（LLM_BASE_URL/MODEL_NAME/LLM_API_KEY，gitignored）；模型为推理型（deepseek-v4-flash），chat 超时 90s。
- 读 API 走 caches.default 60s（review/ping 不缓存）；错误统一 `{ error: { code, message } }`；分页按期 `?before_date=`（ADR-0012）。
- lint 存量 warn（react-hooks/set-state-in-effect 挂载期同步模式，约 12 处）——已知范式，勿"修"。

## 默认验证方式

```text
- 纯函数：npx vitest run <file>（测试同目录；worker/sync/、worker/api/、src/lib/、src/components/dashboard/）
- Worker 行为：wrangler dev（本地模拟 D1）+ curl；守卫态用 --var ADMIN_TOKEN:xxx
- 前端：npm run dev（:3000）；npm run build 46 静态页
- 门禁：npx tsc --noEmit && npx tsc --noEmit -p worker && npx eslint . && npx vitest run
- 真实 LLM 仅限 enrich/parse 小批次抽验，不作默认验证
```

## 后续会话约束

- 优先相信代码和本文件；不要把历史 spec/plans 当必读（spec07-10 在 docs/spec/，部署清单在 handoffs/）。
- 并行 subagent 上限 **2**（超限报 concurrency error）；同一文件的票永远串行；agent 静默卡死按文件 mtime 判定，重派前 git status 查半成品。
- 改 companies.yaml 后跑 `npm run gen:registry`，勿手改 registry.generated.ts。
- 任何破坏 Item schema（ADR-0002）、白名单闸门（ADR-0001）、三段制暂存语义（ADR-0015）的改动，先读对应 ADR。

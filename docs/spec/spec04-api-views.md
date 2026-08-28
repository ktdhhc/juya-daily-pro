# Spec 04 · read API Worker + 三视图 + 「合订本」界面落地（工程性，线性执行）

> 上游依据：`docs/plans/mvp-build-phases.md` 阶段 4；PRD REST API 形状 / 视图渲染细节；ADR-0004（三路由）、ADR-0007（档案头五块）、ADR-0012（URL facet）、ADR-0014（按期分页 before_date、无 role）、`docs/FRONTEND_DESIGN.md`（视觉契约）。
> 首页 `/` 不动（ADR-0013）。

## 目标

Worker read API 5 端点 + 前端 `/stream`、`/company`、`/company/[id]` 三视图按 FRONTEND_DESIGN 落地，`wrangler dev` + `npm run dev` 双进程本地全链路可点。

## 前置事实（已核验）

- 数据：items 1105（ok 863 / missing_owner 242）、item_companies 1222（role 全 NULL）、companies 30、sources 72。
- `wrangler.jsonc` main 指向 `worker/sync/index.ts`（不存在，本 spec 创建）；D1 binding 名 `DB`。
- `src/lib/juya.ts` 的 `parseMarkdown`（概览解析）为纯函数，Worker 可直接 import。
- `worker/registry.generated.ts` 在 worker/ 下——本 spec 迁移到 `src/lib/registry.generated.ts`（前端 generateStaticParams 也要用）。
- eslint 忽略 `worker/**`；root tsconfig include 全部 ts（含 worker/）——引入 `@cloudflare/workers-types` 会与前端 DOM lib 冲突，故 worker 独立 tsconfig（见 Step A1）。
- 静态导出下动态路由必须 `generateStaticParams` 枚举——REGISTRY 30 家即枚举来源；未知 id 由客户端 404 态兜底。

## API 契约（钉死，worker 与前端按此并行开发）

统一：错误 `{ error: { code, message } }`（400 参数非法 / 404 资源不存在 / 405 方法不符 / 500）；成功响应带 `Cache-Control: public, max-age=60` 并写入 `caches.default`（本地近似 no-op，不阻塞正确性）。

1. `GET /api/daily/latest` → `{ date, markdown, parsed: { title, coverImage?, videoLinks, overview } }`（markdown 取 sources 最新一期；parsed 来自 `parseMarkdown`）
2. `GET /api/daily/:date` → 同上（指定日期；404 `daily_not_found`）
3. `GET /api/items?company=&category=&from=&to=&before_date=&limit=`
   - `limit`：每页**期数**，默认 7，上限 31；`before_date` 缺省 = 从最新开始
   - 响应 `{ items: ItemCard[], nextBeforeDate: string | null }`；`nextBeforeDate` = 本页最早期日；本页期数 < limit → null（到底）
   - `ItemCard = { id, date, tag, sequenceInt, category, title, primaryLink: string|null, summary, relatedLinks: string[], enrichState, owners: { company: string, name: string, color: string }[] }`（**无 role**，ADR-0014；owners 按 company id 排序）
   - 过滤参数作用于期集合与条目集合两层（`from`/`to` 闭区间；`company` 走 item_companies EXISTS）
4. `GET /api/companies` → `{ companies: [{ id, name, color, notes, aliases, status, stats: { total, last30d, lastEventDate } }] }`（按 total 倒序）
5. `GET /api/companies/:id` → `{ company: { id, name, color, notes, aliases, status }, stats: { total, last30d, lastEventDate, categoryDistribution: Record<string, number>, coworkers: { companyId, name, color, count }[]（≤8 按次数倒序）, timeSpan: { earliest, latest } } }`（404 `company_not_found`）
   - 实现注记：PRD 原文"响应含该公司 Item 列表"由**前端组合** `/api/items?company=<id>` 承担（复用卡片与分页），本端点只出档案头五块——避免两套分页。

## 执行步骤（两线并行，契约即接口）

### A 线 — Worker read API（agent A）

A1. **worker 独立 tsconfig**：devDep `@cloudflare/workers-types`；新建 `worker/tsconfig.json`（target/lib ES2022、`types: ["@cloudflare/workers-types"]`、strict、noEmit、moduleResolution bundler、include `./**/*.ts` 与 `../src/lib/juya.ts`、`../src/lib/schema.ts`、`../src/lib/registry.generated.ts`）；root tsconfig `exclude` 加 `worker`；package.json `typecheck` 改为 `tsc --noEmit && tsc --noEmit -p worker`（CI 复用同一 script 无需改）。
A2. **registry 生成物迁移**（与 B 线无关，A 先行）：`scripts/gen-registry.ts` 输出路径改 `src/lib/registry.generated.ts`；`backfill.ts` import 改 `../src/lib/registry.generated`；`worker/registry.test.ts` 移为 `src/lib/registry.test.ts` 并改 import；删除 worker/registry.generated.ts；重跑 `npm run gen:registry` 确认产物一致（diff 应为空）。
A3. `worker/api/queries.ts`：纯 SQL 构造器（`buildItemsDatesQuery` / `buildItemsForDatesQuery` / `buildOwnersForItemsQuery` / `buildCompaniesIndexQuery` / `buildCompanyProfileQueries`），输入过滤参数、输出 `{ sql, params }`——**vitest 单测**（过滤组合：company/category/from/to/before_date/limit 边界、默认值、注入安全=全参数化）。
A4. `worker/api/routes.ts` + `worker/sync/index.ts`（Worker entry，default export fetch handler）：路由分发 5 端点 + caches.default 包装 + 统一错误格式。D1 查询用 binding `env.DB.prepare(...).bind(...)`。
A5. 验证：`npx wrangler dev`（本地）后台起服 → curl 五端点：`/api/items` 默认页 7 期；`/api/items?company=anthropic&limit=3`；`/api/items?category=要闻&before_date=2026-08-01&limit=2`；`/api/companies` 30 家含统计；`/api/companies/anthropic` 五块齐（coworkers ≤8）；`/api/daily/latest` 与 `/api/daily/2026-08-27`；404 路径（`/api/companies/nope`、`/api/daily/1999-01-01`）错误格式正确。四门禁绿（vitest 含 queries 单测）。

### B 线 — 前端三视图 + 界面契约落地（agent B，与 A 并行，只依赖上面钉死的契约）

B1. **tokens 与公共类**（globals.css）：按 FRONTEND_DESIGN §3 追加 `--rule / --radius-control|overlay|content / --shadow-overlay / --shadow-edge / --ease-out / --dur-*` 与公共类 `.rule-t`（1px 顶细线）、`.seal`（方形钤印基类，2px 圆角）、`.v-label`（竖排）、`.galley`（骨架轮廓块）+ `@keyframes ink-sweep`（2.4s 低对比斜向扫光）。cyber 主题去 glow：删改 `text-shadow/box-shadow` 辉光三处，收敛为"终端打印纸"。
B2. **Header 报头改造**：品牌方印（「橘」字 .seal）+ Nav 三联（日报/事件流/公司，宽字距，激活 3px 墨线，hover 墨线自左展开）+ 右侧刊号/主题切换/日历入口；新增 `active` prop；阅读页专属控件（进度条、复制链接、外链）仅 `/` 显示。DailyPage 调用处传 `active="daily"`。
B3. **ItemCard 组件**（`src/components/stream/ItemCard.tsx`）：FRONTEND_DESIGN 4.2 全要素——48px 页边编号列（`#N` 18px/300 等宽；无编号显示 `·`）、细线分隔、衬线标题 + ↗、元数据行、摘要、脚注行（相关链接数 + 公司钤印 .seal 18px 单字 + title tooltip）；hover 背景 `--bg-warm` + 左侧 2px 墨线展开；多公司并列等尺寸；`variant="company"` 时按 PRD 差异渲染（单家不渲染徽章与跳转，多家渲染对方徽章）。
B4. **/stream 视图**（`src/app/stream/page.tsx` + `src/components/stream/StreamView.tsx` + `FacetRail.tsx`）：
   - facet（公司下拉数据 = `/api/companies`；分类 = CONTEXT.md 七分类常量；日期范围 from/to）；facet 状态 ↔ URL query 双向同步（ADR-0012，复用 DailyPage popstate 范式），**before_date 不进 URL**；
   - 首屏近 7 期（limit=7），滚动到底自动 `before_date` 翻页（IntersectionObserver），facet 变更清空重载；
   - 骨架 = `.galley` 结构同构块 + ink-sweep + 竖排「排版中」；空态/404/失败态按 FRONTEND_DESIGN 4.6（竖排短语 + 文字链重试）。
B5. **/company 索引**（`src/app/company/page.tsx` + `src/components/company/CompanyIndex.tsx`）：印章卡片墙（.seal 单字 + 名 + total + notes 一句）按 total 倒序 + 客户端搜索框；卡片点击 → `/company/<id>`。
B6. **/company/[id]**（`src/app/company/[id]/page.tsx` + `CompanyProfile.tsx`）：`generateStaticParams` 由 `@/lib/registry.generated` 枚举；档案头五块（基础印+名+notes+aliases / 统计 / 分类分布条形（div 宽度条，无图表库）/ 关联公司 ≤8 钤印可点 / 时间跨度）+ 底部 Item 列表（复用 `/api/items?company=` + ItemCard variant="company" + 分页加载）。
B7. **阅读页一致性改造**：`DatePicker` 重排为合订本目录（FRONTEND_DESIGN 4.4：竖排月份 + 裸数字网格 + 当前压印 + 浮层 `--radius-overlay` + `--shadow-overlay`，数据模型/交互不变）；DailyPage 骨架换 `.galley`（弃 animate-pulse）。
B8. 验证：`npm run build` 成功（含 /company/30 静态页）；四门禁绿；`npm run dev` 下用 msw 式… **不需要 mock**——契约钉死后本地先以占位 fetch 容错（fetch 失败显示失败空态即可），集成验证在 Step C。

### C 线 — 集成与多模态验证（主会话执行）

双进程起服 → curl 五端点冒烟 → 浏览器截图对照 FRONTEND_DESIGN §6 反通用三问逐条核对：/（报头改造 + 合订本）、/stream（facet 筛选、滚动翻页、hover 态）、/company（搜索）、/company/anthropic（五块 + 差异渲染卡片）、主题切换、骨架态。发现问题 → 追加票修复。

## 验收清单

- [ ] 五端点 curl 全部符合契约（含 404 错误格式）
- [ ] queries SQL 构造器有单测（过滤组合 + 参数化）
- [ ] `npm run build` 产出 out/ 且含 /company/anthropic 等静态页
- [ ] 四门禁绿；`src/lib/juya.ts` 行为未变；首页视觉仅报头/骨架/日历变化
- [ ] 浏览器截图核对 FRONTEND_DESIGN §6 三问通过
- [ ] 零登录、零 LLM

## 边界

- 不做全文检索（Phase 2）；不做 admin 端点；不做 ISR/SSR（静态导出维持）。
- 不动 `worker/sync/{parse,match,archive,sqlgen}.ts` 的既有导出（registry 迁移仅动生成物与引用）。
- 6 主题变量名语义不变；cyber 仅去辉光。

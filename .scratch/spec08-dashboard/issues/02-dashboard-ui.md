# 02 · 前端：/dashboard 面板页 + 四种自绘图表 + FRONTEND_DESIGN §4.8

Status: ready-for-agent

## What to build

按 `docs/spec/spec08-dashboard.md` Step 1（§4.8 契约）与 Step 3（3.1→3.3）执行。**全部 SVG/CSS 自绘，禁图表库**。前置：spec07 交付的 `isAdmin()/AdminGate`、spec08-01 交付的 `GET /api/stats`（契约字段以 spec「契约（钉死）」节为准，前端类型手工对齐该 JSON）。

### Step 1 — FRONTEND_DESIGN 契约补节

`docs/FRONTEND_DESIGN.md` 末尾追加「§4.8 数据面板」：图表一律纸底墨线（折线 1.5px 单色墨 + 强调色当前点）、墨条复用 `.dist-*` 语言、环形三段用 墨/朱橙/弱化灰 三色（禁渐变与彩虹）、热力图 ok=墨色深浅按当日条数 4 档、失败=朱橙、缺=空格；tooltip 沿用 data-tip 浮层；空态按 §4.6。风格与该文档现有章节一致（先读 §4.1-4.7 再写）。

### Step 3.1 — 组件族（src/components/dashboard/）

- **StatTiles.tsx**：五块数字（期数/条目/公司/归属率/最近同步），tabular-nums，`rule-t` 分隔；最近同步附相对时间「x 小时前」（不足 1 小时 →「x 分钟前」）。
- **TrendLine.tsx**：SVG 折线（1.5px 墨线 + 数据点圆点，末点强调色）；hover 最近数据点 tooltip「MM-DD · N 条」；**点击数据点 → `router.push('/?date=' + date)`**。数据为稀疏日数组（无数据日不画点）。
- **RankBars.tsx**：横向墨条两组（分类全量 / 公司 Top12）；公司行内嵌 LogoSeal 小印（从 `src/lib/logos.generated.ts` 取，缺省回退首字印）；条宽按组内 max 比例；点击分类 → `/stream?category=`、公司 → `/company/<id>`；沿用 `.dist-*` 墨条视觉语言（参考 CompanyProfile 实现）。
- **EnrichDonut.tsx**：SVG 环形三段（ok=墨 / missing_owner=朱橙 / pending=弱化灰，stroke-dasharray 实现），中心「归属率 NN%」；每段 hover tooltip 带数字；不做点击跳转。
- **SyncHeatmap.tsx**：CSS grid 近 12 周（列=周、行=周一至周日；84 天由 sync 数组对齐网格，缺日=空格）；ok 格墨色深浅按当日条数分 4 档（当日条数从 daily 数组按 date 对齐，无则按最低档）；`fetch_failed`/`parse_failed` 格朱橙；hover tooltip「MM-DD · ok · N 条」或错误摘要。
- **tooltip 泛化**：`data-tip` 浮层 CSS 目前只挂在 `.seal[data-tip]`（globals.css:155）。在 globals.css 该规则旁**追加**通用规则（建议 `.has-tip[data-tip]:hover::after { …同款… }` 或把两条选择器合并），`.seal` 现状不得回归。这是本票唯一允许的 globals.css 改动（纯追加/选择器合并）。
- 页面 **src/app/dashboard/page.tsx**（"use client"）：挂载时 `isAdmin()` 为真 → `apiFetch<StatsResponse>("/api/stats")` 渲染五段布局（总览块 / TrendLine / RankBars×2 / EnrichDonut / SyncHeatmap）；访客 → 渲染「需要管理口令」空态（§4.6 竖排短语风格）+ `<AdminGate onVerified={...}>` 原地验证，验证通过立即拉数据渲染，无需跳转；加载失败 → §4.6 错误态 + 重试文字链。

### Step 3.2 — 导航

`src/components/Header.tsx`：`HeaderActive` 联合类型加 `"dashboard"`；NAV 里「面板」项**仅管理员态渲染**（`isAdmin()` 判定，注意组件挂载后读一次的角色态与 AdminGate 升级后的同步——Header 内已有管理员 state 则直接复用）。

## 红线

- 禁止 git commit / git add。
- 只允许改动：`src/app/dashboard/page.tsx`（新建）、`src/components/dashboard/` 下组件（新建）、`src/components/Header.tsx`、`src/app/globals.css`（仅 tooltip 泛化一处）、`docs/FRONTEND_DESIGN.md`（仅追加 §4.8）。其他文件不碰。禁止 git commit / git add。
- 禁引入任何图表库（grep package.json 无新依赖）；图表全部内联 SVG/CSS。
- TS strict；中文注释；配色只用既有 CSS 变量（var(--fg)/var(--accent)/var(--fg-muted) 等），不得硬编码色值。

## Acceptance criteria

- [ ] `npx tsc --noEmit` 绿；`npx eslint src/app/dashboard src/components/dashboard` 0 error
- [ ] `npm run build` 通过且静态页 44→45（+dashboard）；grep `recharts|chart.js|d3` 零命中
- [ ] 汇报：五段布局与四图表的交互说明（tooltip 触发方式 / 点击跳转目标 / 热力图分档规则）
- [ ] 浏览器走查由主会话执行（逐图 tooltip / 跳转 / 访客 403 态 / 管理员解锁）

## Blocked by

.spec07-role-baseline/issues/02-frontend-admin-role.md（AdminGate 与角色态）
.spec08-dashboard/issues/01-stats-api.md（/api/stats 可实测）

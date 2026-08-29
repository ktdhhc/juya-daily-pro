# Spec 08 · 数据面板（工程性，线性执行）

> 来源：2026-08-29 用户需求——聚合可视化数据面板，图表选型由实现方决定。上游：**依赖 spec07**（管理员角色 + requireAdmin 守卫）；FRONTEND_DESIGN（图表语言先补契约防漂移）；路线图既定决策——**不上图表库，全部 SVG/CSS 自绘**。
> 本文可按顺序逐步执行。**零登录、零 LLM。**

## 目标

`/dashboard` 页（导航「面板」，仅管理员可见）：一次拉取全部聚合数据，五段布局呈现——总览块 / 折线趋势 / 墨条 ×2 / 环形占比 / 同步热力图；hover 全 tooltip，折线与墨条可点击跳转对应视图。

## 前置事实（已核验）

- 数据基线：sources 73 期、items 1116、companies 39、item_companies 1485、sync_log 含 ok 与一条 2099 演练行。
- spec07 已交付：管理员角色态（src/lib/auth.ts）、requireAdmin 守卫、apiFetch 自动附头。
- 公司档案页已有 `.dist-*` 墨条模式与 LogoSeal 组件——分类/公司条形直接复用。
- 图表交互依赖的跳转目标已存在：`/?date=`、`/stream?category=`、`/company/<id>`。

## 契约（钉死）

`GET /api/stats`（requireAdmin；403 `unauthorized`）单端点返回：

```json
{
  "overview": { "issues": 73, "items": 1116, "companies": 39,
                "attributed": 988, "attributedRate": 0.885, "lastSyncAt": "2026-08-29 03:20:00" },
  "daily":     [{ "date": "2026-08-29", "items": 22, "issues": 1 }],      // 近 90 天，日期升序，无数据日缺省
  "categories":[{ "category": "要闻", "count": 39 }],                       // 全部分类，count 倒序
  "companies": [{ "id": "openai", "name": "OpenAI", "count": 266 }],        // Top 12，count 倒序
  "enrich":    { "ok": 988, "missing_owner": 128, "pending": 0 },
  "sync":      [{ "date": "2026-08-28", "status": "ok", "error": null }]    // 近 84 天 sync_log，升序
}
```

`lastSyncAt` 取 sync_log 中 status='ok' 的 MAX(attempted_at)；`attributed` = enrich_state='ok' 条数；logo 不进本端点（前端从既有 /logos/ 清单取）。

## 执行步骤（线性）

### Step 1 — FRONTEND_DESIGN 契约补节

追加「§4.8 数据面板」：图表一律纸底墨线（折线 1.5px 单色 + 强调色当前点）、墨条复用 dist 语言、环形三段用 墨/强调/弱化 三色（禁渐变与彩虹）、热力图 ok=墨色深浅（按当日条数分 4 档）、失败=朱橙、缺=空格；tooltip 沿用 data-tip 浮层；空态按 §4.6。修改在 commit message 显式声明。

### Step 2 — 服务端聚合

2.1 `worker/api/stats.ts`：查询构造器纯函数集（每日 items/issues 聚合、分类聚合、公司 Top12 聚合、enrich 分布、sync_log 近 84 天、总览合成）+ `buildStatsResponse` 组装。vitest：各构造器过滤/排序/上限用例（ADR-0011，红→绿）。
2.2 `routes.ts`：`GET /api/stats` 挂 requireAdmin，组装响应，60s caches.default 包装同款。
2.3 验证：8788 带 token 实例 curl 全键结构；无头 403；四门禁绿。

### Step 3 — 前端 /dashboard

3.1 `src/app/dashboard/page.tsx`（"use client"）+ `src/components/dashboard/` 组件族：
  - **StatTiles**：五块数字块（tabular，rule-t 分隔，最近同步含相对时间「x 小时前」）
  - **TrendLine**：SVG 折线（1.5px 墨线 + 数据点 + hover 最近点 tooltip「08-28 · 22 条」）+ 点击数据点跳 `/?date=`
  - **RankBars**：横向墨条 ×2（分类 / 公司 Top12；公司行内嵌 LogoSeal 小印）+ 点击跳转（分类 → `/stream?category=`；公司 → `/company/<id>`）
  - **EnrichDonut**：SVG 环形三段（ok=墨 / missing=朱橙 / pending=弱化灰），中心「归属率 88%」，hover 段 tooltip 带数字；不做点击跳转（事件流暂无状态筛入口）
  - **SyncHeatmap**：CSS grid 近 12 周（列=周、行=周一至周日）：ok 格墨色深浅按当日条数 4 档、`fetch_failed`/`parse_failed` 格朱橙、无记录格空；hover tooltip「08-28 · ok · 22 条」或错误摘要
3.2 导航与守卫交互：Nav 管理员态追加「面板」；访客直接访问 `/dashboard` → 渲染「需要管理口令」空态 + 口令输入条（复用 spec07 组件，验证通过原地渲染面板，无需跳转）。
3.3 空态/失败态按 FRONTEND_DESIGN §4.6（竖排短语 + 文字链重试）。

### Step 4 — 验证

- 浏览器逐图：tooltip / 点击跳转 / 环形占比与数字一致（与 D1 查询对账）；访客 403 态；管理员全流程。
- 四门禁绿；build 静态页 +1（dashboard 壳）。

## 验收清单

- [ ] /api/stats 契约实测（token 403/200 两态）+ 构造器单测红→绿
- [ ] 四种图表全自绘（grep 无 chart 依赖）；tooltip 与点击跳转实测
- [ ] 环形数字与 D1 对账一致（ok/missing/pending = 全量）
- [ ] 访客 403 空态 + 口令后原地解锁
- [ ] 四门禁绿；FRONTEND_DESIGN §4.8 已入

## 边界

- 不做 FTS、不做按 enrich_state 筛事件流、不做图表库引入、不做数据导出。
- 聚合即时查询（数据量千级，无需缓存表）；60s caches.default 已覆盖。

# 02 · 前端：热力图修订 + 阅读时间线 + 搜索联想与高亮

Status: ready-for-agent

## What to build

按 `docs/spec/spec11-feedback-round2.md` 契约 D/E/F 三节与 Step 2 执行。**只动 src/ 与 docs/FRONTEND_DESIGN.md，零 worker。**

### 2.1 SyncHeatmap 修订（契约 D，§4.8 修订）

`src/components/dashboard/SyncHeatmap.tsx` + `chartMath.ts` 的 `buildHeatmapCells`：
- 84 格全部渲染；无记录日 = 最浅中性（`color-mix(in srgb, var(--fg) 8%, transparent)`）+ tooltip「MM-DD · 无同步记录」；ok 深浅四档只按当日条数（0 条=最浅同无记录色、1-9、10-19、≥20）；失败=朱橙；未来日期=空格无 tooltip。
- `heatmapLevel` / `buildHeatmapCells` 纯函数改语义后同步修测试（先红后绿：无记录格级别、0 条档位、未来格）。

### 2.2 阅读时间线（契约 E，§4.10 新节）

- 新建 `src/components/stream/TimelineRail.tsx`：props 传当期条目清单（`{ sequenceInt, title }[]`）+ mainRef。固定定位竖轨（左侧，垂直居中，仅 `sm:` 以上渲染——用 CSS 隐藏，不做 JS 判断）；每条目一枚刻度（12×2px，`--fg-muted` 30% 透明，圆角 1px）；hover 刻度 → 左向 tooltip（条目标题截 24 字，复用 `.has-tip[data-tip]` 泛化浮层——注意方向在左侧需新变体类 `.has-tip-left`，globals.css 追加同款规则改 right 定位）；点击 → `scrollToId('article-' + sequenceInt, mainRef.current)`（`src/components/ArticleView.tsx` 已导出该函数，import 复用）。
- **scrollspy**：监听 mainRef scroll（passive），按各 `#article-N` 的 offsetTop 与 scrollTop+视口 40% 判定当前条目 → 该刻度 accent 色 + 18px 长；用 `useState` 存当前 id，节流 ~100ms。
- `src/app/DailyPage.tsx`（或日报页实际组件）集成：仅 `active === "daily"` 且条目清单非空时渲染于内容列左缘。
- 交互注意：刻度是 `<button>`（aria-label=条目标题），不抢卡片焦点。

### 2.3 搜索联想与高亮（契约 F，§4.11 新节）

- `src/lib/api.ts`：新增 `SuggestItem` 类型 + `fetchSuggest(q): Promise<{ items: SuggestItem[] }>`（GET `/api/search/suggest?q=`，走 apiFetch）。
- `src/components/Header.tsx` 搜索条改造：输入 ≥1 字符 → 250ms debounce 调 fetchSuggest → 输入条下方下拉（绝对定位，`--bg` 底 + 细线分隔 + 阴影 token），每行 = 标题（HighlightText 高亮）+ snippet（HighlightText）+ 右侧日期小字（MM-DD tabular）；点击行 → `router.push('/?date=' + date + (sequenceInt>0 ? '#article-'+sequenceInt : ''))` 并收起；Escape 收起、失焦收起（注意 mousedown 先于 blur 用 onMouseDown 导航）；↑↓ 在建议间移动 + 高亮选中行、Enter 在选中建议时跳该条否则走原提交。竞态防护：仅最后一次请求的结果可渲染（序号守卫）。
- 新建 `src/components/common/HighlightText.tsx`：props `{ text, query }`——大小写不敏感找 `query.trim()` 全部出现位置，拆分为 `<mark>` + 原文段（不 dangerouslySetInnerHTML）；query 空 → 原文。`mark` 样式进 globals.css：`background: color-mix(in srgb, var(--accent) 18%, transparent); color: inherit; border-radius: 2px;`。
- `src/components/stream/StreamView.tsx`（或条目列表实际位置）：把 `query` 传到 ItemCard，title 与 summary 用 HighlightText 包裹（仅 query 非空时）。
- Header 同步成功文案（syncPhase ok 分支）：`res.stagedDates.length > 0 ? '同步 N 期 · M 期待审核' : '同步 N 期'`。

### 2.4 FRONTEND_DESIGN

- §4.8 热力图条目按契约 D 修订；新增「§4.10 阅读时间线」「§4.11 搜索联想与高亮」（风格对齐现文：段落短、只写语言与 token，不写实现）。

## 红线

- 禁止 git commit / git add。
- 只允许改动：`src/components/dashboard/SyncHeatmap.tsx`、`src/components/dashboard/chartMath.ts` + 测试、`src/components/stream/TimelineRail.tsx`（新建）、`src/components/stream/StreamView.tsx`、`src/components/stream/ItemCard.tsx`、日报页组件（`src/app/` 下 daily 相关）、`src/components/Header.tsx`、`src/components/common/HighlightText.tsx`（新建）、`src/lib/api.ts`（仅 suggest 类型与封装 + SyncResponse 注释）、`src/app/globals.css`（mark 样式 + `.has-tip-left` 追加）、`docs/FRONTEND_DESIGN.md`（§4.8 修订 + §4.10/4.11）。其他不碰（尤其 worker/、scripts/）。
- TS strict；不新增依赖；配色只用既有变量 + 契约中给定的 color-mix；中文注释。
- `npx tsc --noEmit` 绿；`npx eslint` 改动文件 0 error；`npx vitest run` 全量绿（275+ 不得回归，chartMath 修订后仍绿）；`npm run build` 46 页。

## Acceptance criteria

- [ ] chartMath 热力图新语义单测红→绿；全量 vitest 绿
- [ ] 汇报：三块交互结构说明（时间线 scrollspy 判定、联想竞态防护、高亮拆分策略）+ 门禁输出
- [ ] 浏览器走查由主会话执行

## Blocked by

None - can start immediately（suggest 端点由并行 worker 票交付，按 spec11 契约 C 开发即可）

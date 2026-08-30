# Spec 11 · 反馈第二轮：同步语义修复 / 热力图 / 阅读时间线 / 搜索引擎化

> 来源：2026-08-30 用户反馈四点 + 故障复盘（0830 解析 401 → stagedDates 误报 → 审核页空）。上游：spec08（面板/热力图）、spec10（编辑工作流）、spec06（搜索）。
> 本文可按顺序逐步执行。零 LLM 单测（ADR-0011）。

## 故障复盘结论（已核实，写进 A 线验收）

- 401 根因：worker 的 `LLM_API_KEY` 走 `.dev.vars`，当时缺失（脚本走 `.env` 不受影响）；用户已补，**部署日 `wrangler secret put` 不变**。
- `stagedDates` 误报：sync 响应把「窗口内抓取成功的期」当成「待审核期」——重同步已发布期时误报「同步 N 期（待审核）」而审核页为空。
- 已发布多家命中且解析失败的条目（role 双 NULL）没有任何 UI 重解析路径（只能跑命令行）。

## 契约（钉死）

### A. sync stagedDates 语义修正
`POST /api/sync` 响应：`dates` 不变（窗口内抓取成功期）；**`stagedDates` = 同步执行后 `items.published=0` 的期日期（升序，末尾一次查询）**。前端文案：stagedDates 为空 → 「同步 N 期」；非空 → 「同步 N 期 · M 期待审核」。

### B. parse 重解析通道（解析失败补救）
`/api/parse` 圈题扩展为两类：①暂存多家命中且无 proposal（原有）；②**已发布（published=1）多家命中、无 enrich_cache、且存在 role IS NULL 的归属行**（解析失败后的人工补救通道）。remaining = 两类之和。有 enrich_cache 的条目永不重圈（人工纠错走 `enrich --apply`）。

### C. suggest 端点
`GET /api/search/suggest?q=<term>&limit=8`（公开，withCache 60s）：LIKE 匹配 title/summary（转义同 /api/items q 参数），**title 命中优先、组内 date DESC**，返回 `{ items: [{ id, date, tag, sequenceInt, category, title, summary, snippet }] }`——snippet = summary 中命中词前后各约 40 字符的纯文本片段（无命中则 summary 前 80 字），由纯函数 `summarizeMatch(summary, q)` 生成。q 为空/无命中 → `{ items: [] }`。

### D. 热力图修订（§4.8 修订）
84 格全部渲染：**无记录日 = 最浅中性格**（`color-mix(in srgb, var(--fg) 8%, transparent)`）+ tooltip「MM-DD · 无同步记录」；ok 深浅只按**当日条数**四档（0 条=最浅、1-9、10-19、≥20）；失败=朱橙；未来日期=纯空格无 tooltip。

### E. 阅读时间线（§4.10 新节）
`/` 阅读页左侧固定竖向刻度轨（仅桌面 ≥sm；`/stream` 等视图不出现）：当期每个条目一枚短横刻度（12px×2px，`--fg-muted` 30% 透明），hover 展开左侧 tooltip（条目标题，截 24 字），点击 `scrollToId(article-N)`；**scrollspy**：滚动时可视条目的刻度转 accent 色、加长到 18px。轨道垂直居中于视口，贴近内容列左缘。

### F. 搜索联想与高亮（§4.11 新节）
- 报头搜索条输入 ≥1 字符即触发 suggest（250ms debounce，Escape/失焦收起，↑↓ 可选、Enter 直提）——下拉行：标题（高亮命中）+ snippet（高亮命中）+ 右侧日期小字；点击行 → `/?date=#article-N` 跳转。
- 回车/提交 → `/stream?query=` 结果列表中 title 与 summary 的命中词 **`<mark>` 高亮**（`color-mix(in srgb, var(--accent) 18%, transparent)` 底、inherit 文字色），组件 `HighlightText`（大小写不敏感整串匹配，纯拆分不内联 HTML 拼接）。

## 执行步骤

### Step 1 — Worker 线（票 11-01）
1.1 `stagedDates` 修正：syncNow 批尾查 `SELECT DISTINCT date FROM items WHERE published=0 ORDER BY date` → 响应；单测不可达（routes 层）以 curl 实测为准。
1.2 parse 圈题扩展：`selectParseTargets` 增第二类输入（已发布缺主次清单）+ 纯函数单测红→绿；报告 remaining 语义更新。
1.3 suggest：`buildSuggestQuery(q, limit)`（queries.ts 构造器，转义复用）+ `summarizeMatch`（纯函数）红→绿；路由挂载。
1.4 curl 验收：suggest 两态（有/无命中、转义）；parse 重解析实测（本地 D1 删一条 enrich_cache + role 置 NULL → parse → 恢复 → 复原核对）。

### Step 2 — 前端线（票 11-02）
2.1 SyncHeatmap 按 §4.8 修订；2.2 TimelineRail + DailyPage 集成（§4.10）；2.3 Header 搜索联想下拉 + HighlightText + stream 结果高亮（§4.11）；2.4 同步成功文案按 stagedDates 语义。FRONTEND_DESIGN §4.8 修订 + §4.10/4.11 新节。

### Step 3 — 验证
四门禁；浏览器走查（时间线 scrollspy/点击、联想下拉/高亮、热力图空日、stagedDates 文案两态）主会话执行。

## 边界
- 不做搜索分词/多词 AND、不做全局搜索入口迁移、不做时间线移动端、不做 suggest 缓存策略调优。

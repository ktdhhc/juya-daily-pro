# Spec 14 · 审核数据控制页重做（今日流水线卡 + 待办 tab + 同步运行记录）

> 来源：2026-09-06 用户反馈——现有横向三段条 + 散点计数「太模糊太让人疑惑，根本不能一眼看到关键信息」；测试日报复现实锤暂存期每同步重报「新增」。上游：spec12/13（解析作业/收件台）。
> 调研对标：Vercel deployments（状态卡+唯一主按钮）、GitHub PR（可做才亮、不可做讲原因）、Airbyte/Healthchecks（一行=一次运行的同步历史）。
> 交付约束：**全部完成后不提交，留在工作区等用户决定。**

## 目标

审核台首屏变成「一眼三层」：今日流水线卡（三段最近一次结果 + 三个动作按钮）→ 待办 tab（该做什么）→ 同步运行记录表（发生了什么）。废弃横向流水线条、散点计数行、同步 toast、独立解析面板首屏。

## 契约（钉死）

### A. sync_runs 表（迁移增量，parse_state 同款幂等引导）
```sql
CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  duration_ms INTEGER,
  window_dates TEXT NOT NULL,        -- JSON: 本轮窗口期日期数组
  added TEXT NOT NULL DEFAULT '[]',  -- JSON
  updated TEXT NOT NULL DEFAULT '[]',-- JSON
  unchanged TEXT NOT NULL DEFAULT '[]', -- JSON
  failures TEXT NOT NULL DEFAULT '[]',  -- JSON: [{date, error}]
  staged_items INTEGER NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 1
);
```

### B. syncNow 落运行记录 + GET /api/review/sync-runs
- syncNow 响应成功路径末尾 INSERT 一行 sync_runs（started_at=now、duration_ms=实测、窗口/三分类/失败 JSON、staged_items、ok）。
- `GET /api/review/sync-runs?limit=20`（requireAdmin、不进缓存）：`{ runs: [{ startedAt, durationMs, windowDates, added, updated, unchanged, failures, stagedItems, ok }] }` 倒序。纯函数 assembleSyncRuns 红→绿。

### C. 今日流水线卡（FlowCard 重做，替代 FlowHeader+ParsePanel 首屏+状态条）
三段行 + 三个按钮：
- ① 已同步：最新一次 sync_runs 摘要（时间 · 窗口 N 期 · 新增 X/更新 Y/未变化 Z · 耗时）；运行中显「同步中…」；无记录显「尚未同步」。
- ② 解析：parse_state 摘要（运行中 k/M 呼吸点标 / 已完成 · 处理 n/m / 失败朱橙 / 空闲）。
- ③ 已入库：published>0 汇总（至 <maxPublishedDate> · 共 X 期 Y 条）。
- 按钮：主按钮「去审核 N 条 →」（N=parsed+noNeed 待审核总数；N=0 禁用显「暂无待办」）滚到待办区；次按钮「同步最新」（运行中互斥禁用「同步中…」）；次按钮「运行解析」（spec13 异步作业，运行中「解析中 k/M…」禁用）。
- 数据流：syncRuns 最新一行 + pending 载荷（parse 字段与条目计数）+ history 汇总。

### D. 待办 tab（替代四态分组首屏区）
三个 tab（计数徽章，默认自动落在第一个非空 tab）：
1. 待审核（parsed + noNeed 合并，条目行照旧 ProposalEditor 编辑）
2. 缺候选待入册（blocked）
3. 异常（解析失败清单——来自 parse.errors + sync failures 摘要；空态「无异常」）
tab 纯函数 `todoTabs(categorized)` 红→绿（序/计数/默认 tab 选取）。

### E. 同步运行记录表（新组件 SyncRunsTable）
每行：时间 · 窗口 N 期 · 新增 X · 更新 Y · 未变化 Z · 失败红字 · 耗时 s · 状态点标；失败行就地「重试」（触发同步）；最近一行与今日卡①行同源。

### F. 废弃清单
FlowHeader（三段横条）、页顶状态条（待解析 X · 已解析…）、ParsePanel 的独立首屏块（运行态并入今日卡②行 + tab3 异常）、Header 同步成功 toast（改为静默，今日卡已常驻显示结果）。parse 轮询机制、ProposalEditor、PublishBar（fixed 底栏入库预览）、同步历史折叠区（由 SyncRunsTable 替代）、CandidatePanel 全部保留。

## 执行步骤

1. worker（票 14-01）：迁移追加 sync_runs；syncNow 落记录；GET /api/review/sync-runs；纯函数红→绿；curl 验收。
2. 前端（票 14-02）：FlowCard 重做 / todoTabs 纯函数红→绿 / SyncRunsTable / tab 区重组 / 废弃清单执行。
3. 验证：四门禁；浏览器走查（今日卡三行数据对账、按钮互斥与禁用语义、tab 默认落点、运行记录与 D1 对账）；**完成后不提交，留工作区**。

## 边界

- 不做同步自动刷新（今日卡①行为手动同步后的最新记录）；不做运行记录分页（limit=20）；解析失败重试=再跑一次解析（幂等）；不改任何同步/解析/入库语义。

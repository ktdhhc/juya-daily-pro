# 02 · 前端：今日流水线卡 + 待办 tab + 同步运行记录表（废弃旧首屏）

Status: ready-for-agent

## What to build

按 `docs/spec/spec14-review-control-redo.md` 契约 C/D/E/F 执行。**只动 src/ 与 docs/FRONTEND_DESIGN.md，零 worker。** 服务端契约（并行票交付，按此开发勿等待）：
- `GET /api/review/sync-runs?limit=20` → `{ runs: [{ startedAt, durationMs, windowDates: string[], added: string[], updated: string[], unchanged: string[], failures: {date,error}[], stagedItems: number, ok: boolean }] }` 倒序
- 既有：pending 载荷（parse 字段、条目、candidate）、fetchReviewHistory

### 2.1 FlowCard 今日流水线卡（新建，替代 FlowHeader + 状态条 + ParsePanel 首屏）

`src/components/review/FlowCard.tsx`：
- 三段行（§4.12 语言，tabular、rule-t 分隔）：
  - ① 已同步：最新 syncRun 摘要（`MM-DD HH:mm · 窗口 N 期 · 新增 X · 更新 Y · 未变化 Z · 耗时 s`，X/Y/Z 为 0 的段省略）；同步中显「同步中…」；无记录「尚未同步」。
  - ② 解析：parse 状态（running「运行中 processed/total」+呼吸点标（既有 breath-pulse）/done「已完成 · 处理 n/m」+完成时间/failed 朱橙「失败」+errors 首条/idle「空闲」）。
  - ③ 已入库：history 汇总（`至 <max date> · 共 X 期 Y 条`；published>0 过滤）。
- 按钮行：主按钮「去审核 N 条 →」（N=parsed+noNeed 计数；N=0 → 禁用文案「暂无待办」；点击滚到 #review-todos）；次按钮「同步最新」（onClick=触发同步，运行中互斥禁用「同步中…」）；次按钮「运行解析」（POST /api/parse；running 禁用「解析中 k/M…」；409 走既有轮询接入）。
- Props 由 page 装配传入（syncRuns 最新行、parse、待办计数、history 汇总、三个回调与两个运行态标志）。文案拼装纯函数 `flowCardRows(...)` 抽出（src/lib/review.ts），**先红后绿**（三态行文案/空记录/0 值省略/N=0 禁用）。

### 2.2 待办 tab（重组 StagedIssueList 区域）

- 纯函数 `todoTabs(categorized)`：返回 `[{ key, label, count, items }]` 三 tab——待审核（parsed+noNeed 合并）/ 缺候选待入册（blocked）/ 异常（parse.errors 摘要行，无条目体）；默认 tab = 第一个 count>0 的 key（全 0 → 待审核）。**先红后绿**（合并序/默认选取/全空）。
- /review 页渲染：tab 头（计数徽章，激活态墨线）+ 对应面板；待审核 tab 内按日期小节列条目（沿用 ReviewItem/ProposalEditor）；缺候选 tab 沿用既有行（含候选提示）；异常 tab 列「itemId · 原因」行。锚点 id="review-todos"。
- 同步/解析完成后重拉数据（既有机制）→ tab 计数与默认落点随之更新。

### 2.3 SyncRunsTable（新建，替代同步历史折叠区）

`src/components/review/SyncRunsTable.tsx`：挂载拉 `fetchSyncRuns(20)`（api.ts 新封装 + SyncRun 类型）；每行 = 状态点标（ok 墨/失败朱橙）· 时间（startedAt MM-DD HH:mm）· 窗口 N 期 · 新增 X · 更新 Y · 未变化 Z（0 省略）· 失败行内红字错误首条 · 耗时（durationMs/1000 取 1 位小数 s）；失败行就地「重试」按钮（调同步回调，运行中禁用）。行尾「较上次新增」小字段：与本行前一行（时间序上一行）added 期集合 diff？——**不做**，直接展示本行 added 数即可（运行记录自身已含三分类）。

### 2.4 废弃清单（契约 F，全部删除）

- `FlowHeader.tsx` 组件及其引用；页顶四态计数状态条（page.tsx 内）；`ParsePanel.tsx` 独立面板（运行态展示与「运行解析」按钮迁入 FlowCard②行与按钮行；parse.errors 展示迁入 tab3 异常；localStorage["juya-last-parse"] 终态缓存**保留**——FlowCard 无服务端运行记录时兜底显示）；Header 同步成功 toast 段（syncPhase ok 分支与 15s 定时器——同步结果已常驻今日卡；fail 分支保留为行内错误）；同步历史折叠区 `HistoryPanel.tsx`（被 SyncRunsTable 替代）。globals.css 仅删确无引用的样式（先 grep）。
- api.ts：新增 SyncRun 类型 + fetchSyncRuns；不删旧类型（ParsePanel 残留引用清理后如产生孤儿类型可删，先确认无引用）。

### 2.5 设计契约

FRONTEND_DESIGN.md §4.12 重写为「今日流水线卡 + 待办 tab + 同步运行记录」三层结构语言（对标 Vercel 状态卡/唯一主按钮/一行一次运行记录；写明废弃的旧结构）。

## 红线

禁止 git commit / git add。只允许改动：`src/lib/review.ts`、`src/lib/review.test.ts`、`src/lib/api.ts`、`src/app/review/page.tsx`、`src/components/review/`（FlowCard/SyncRunsTable 新建；FlowHeader/ParsePanel/HistoryPanel 删除；StagedIssueList/PublishBar 调整）、`src/components/Header.tsx`（toast 段删除）、`src/app/globals.css`（仅清确无引用样式）、`docs/FRONTEND_DESIGN.md`（§4.12 重写）。禁止碰 worker/、scripts/。TS strict；不新增依赖；呼吸点标沿用既有 breath-pulse；配色只用既有变量；中文注释。

## Acceptance criteria

- [ ] flowCardRows / todoTabs 红→绿证据；`npx vitest run` 全量绿（341+ 不回归）
- [ ] `npx tsc --noEmit` 绿；`npx eslint` 改动文件 0 error；`npm run build` 46 页
- [ ] grep 证据：FlowHeader/ParsePanel/HistoryPanel 无残留引用
- [ ] 汇报：今日卡三行数据来源表、tab 默认落点逻辑、废弃清单执行对照、门禁输出

## Blocked by

None（worker 契约由并行票交付，按契约开发）

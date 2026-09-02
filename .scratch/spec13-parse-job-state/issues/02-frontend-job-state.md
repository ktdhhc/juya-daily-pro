# 02 · 前端：解析作业轮询 + 数据流标头 + 刷新恢复

Status: ready-for-agent

## What to build

按 `docs/spec/spec13-parse-job-state.md` 契约 C/D/E/F 与执行步骤 2 执行。**只动 src/ 与 docs/FRONTEND_DESIGN.md，零 worker。** 服务端契约（并行 worker 票交付，按此开发勿等待）：
- `POST /api/parse` 秒回 `{ started: true, state }`；另一轮在跑 → **409** `{ error: { code: "parse_busy" }, state }`
- `GET /api/review/pending` 载荷增 `parse: { status: "idle"|"running"|"done"|"failed", startedAt, finishedAt, processed, total, remaining, errors: string[] }`

### 2.1 轮询（契约 D）

- /review 页：挂载拉一次 pending；`parse.status==='running'` → setInterval 3s 重拉 pending；转入 done/failed → 清定时器并再拉一次数据（新建议落地）。409 命中（POST 返回 parse_busy）→ 立即进入轮询。组件卸载清定时器。纯逻辑（「是否应轮询/何时停」）抽纯函数可测。

### 2.2 数据流标头（契约 E）

- 审核台标题之下新增三段流水线横条（新组件 `src/components/review/FlowHeader.tsx`）：
  `① 已同步 · 暂存 N 条 → ② 解析 · <状态> → ③ 已入库 · X 期 Y 条`
  - N = pending 暂存条目数；② = parse 字段（running 显「运行中 k/M」+呼吸点标动画（CSS opacity 脉冲，禁发光）；idle 显「空闲」；done 显「已完成」；failed 朱橙「失败」）；X/Y = `fetchReviewHistory(30)` 汇总 published>0 的期数与条数（挂载取一次）。
  - 每段一个按钮/锚点，点击平滑滚动到对应区块（解析区 / PublishBar；①段滚到条目区顶部）——用 `scrollIntoView` 或既有 scrollToId 风格。
- 计数纯函数 `flowCounts(...)`（暂存数/解析态/入库期数条数 → 段落数据）抽出可测（`src/lib/review.ts` 或组件内导出），**先红后绿**（运行中态、idle 态、published 过滤）。

### 2.3 ParsePanel 运行态（契约 F）

- running：按钮禁用（文案「解析中 processed/total…」）+ 面板显进度行（进度 N/M + 已用时长（startedAt 起算，前端时钟差容忍））+ 呼吸点标。
- 409：立即切轮询 + 提示「另一处已在运行解析，已接入进度」。
- done：停轮询；若 processed>0 自动重拉数据（新建议出线）。failed：朱橙显失败原因。
- localStorage["juya-last-parse"] 语义降级为缓存（运行态一律以服务端 parse 字段为准——文案与逻辑同步调整）。

### 2.4 设计契约

`docs/FRONTEND_DESIGN.md` §4.12 修订：新增「解析作业状态」语言（轮询驱动、running 进度呼吸点标、409 接入、刷新恢复）与「数据流标头」（三段流水线、点击滚动）。

## 红线

- 禁止 git commit / git add。
- 只允许改动：`src/lib/review.ts`、`src/lib/review.test.ts`、`src/lib/api.ts`（ParseStatePayload/ParseResponse 类型与 fetchParse 返回）、`src/app/review/page.tsx`、`src/components/review/`（ParsePanel/FlowHeader 新建等）、`docs/FRONTEND_DESIGN.md`（§4.12 修订）。禁止碰 worker/、scripts/、next-env.d.ts。TS strict；不新增依赖；配色只用既有变量 + CSS 呼吸动画；中文注释。
- 门禁：`npx tsc --noEmit` 绿；`npx eslint` 改动文件 0 error；`npx vitest run` 全量绿（309+ 不得回归）；`npm run build` 46 页。浏览器走查主会话做。

## Acceptance criteria

- [ ] 纯函数红→绿证据（flowCounts/轮询决策）；全量 vitest 绿
- [ ] 汇报：轮询时序图（启动/409/完成/刷新四路径）、标头数据来源表、契约差异清单、门禁输出

## Blocked by

None（worker 契约由并行票交付，按契约开发）

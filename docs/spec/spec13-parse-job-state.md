# Spec 13 · 解析作业状态化 + 数据流可视化（审核数据控制页）

> 来源：2026-09-02 用户反馈——LLM 解析无明确状态：运行中刷新页面即失忆，不知道有没有在跑；审核页交互与数据流动仍不够清晰，要成为「足够清晰的审核和数据控制页」。上游：spec10（解析端点）、spec12（收件台）。
> 核心判断：解析是分钟级长作业，当前却是「前端挂起等响应」的黑箱调用——**改为服务端异步作业 + 状态落 D1**，刷新/关页/换标签都不丢；再配数据流标头让三段流动一眼可读。

## 目标

1. 「运行解析」秒回；解析在服务端继续跑，状态（运行中/进度/结果/失败原因）落 D1，任何时刻刷新都可见。
2. 运行中防重复启动（409 + 陈旧自愈）；前端自动轮询直到完成。
3. 审核台顶部数据流标头：同步 → 解析 → 入库 三段计数与状态一眼可读。

## 契约（钉死）

### A. parse_state 表（迁移增量，`npm run db:migrate` 幂等）
```sql
CREATE TABLE IF NOT EXISTS parse_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','running','done','failed')),
  started_at TEXT,
  finished_at TEXT,
  processed INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  remaining INTEGER NOT NULL DEFAULT 0,
  errors TEXT NOT NULL DEFAULT '[]'
);
```
单行作业状态（同一时刻至多一轮解析）。

### B. POST /api/parse 改异步作业
- **启动守卫**：`parse_state.status='running'` 且 `started_at` 距今 <10 分钟 → **409** `{ error: { code: "parse_busy", message }, state }`（不重复启动）；超 10 分钟视为陈旧（worker 中断遗留）→ 允许覆盖重跑。
- 正常路径：置 `running`（started_at=now、total=本轮圈题数、processed=0、errors='[]'）→ **立即**响应 `{ started: true, state }` → 解析本体经 `ctx.waitUntil` 继续执行（每完成一条 onProgress 增量 UPDATE processed/remaining/errors；结束置 `done`，作业级异常置 `failed` 并记错误）。无 ctx 的调用场景回退同步执行。
- worker 入口 `fetch(request, env)` → `fetch(request, env, ctx)`，`handleApiRequest(request, env, ctx?)` 线程化（可选参数，兼容既有调用）。

### C. 状态可读
`GET /api/review/pending` 载荷扩展 `parse: { status, startedAt, finishedAt, processed, total, remaining, errors }`（读 parse_state 单行；idle → status:'idle'、余字段 null；errors 为字符串数组）。前端所有解析状态显示以此为准（不再只依赖 localStorage——localStorage 保留为「最近一次我看到的响应」缓存，但**运行态以服务端为准**）。

### D. 前端轮询与刷新恢复
/review 挂载拉一次 pending；`parse.status==='running'` → 每 3s 轮询；转入 `done`/`failed` → 停止轮询并重拉数据一次（新建议落地）。409 命中（另一处已在跑）→ 立即进入轮询。刷新页面天然恢复（状态在 D1）。

### E. 数据流标头（审核台顶部，标题之下）
三段流水线横条（纯展示，点击平滑滚到对应区块）：
```
① 已同步 · 暂存 N 条   →   ② 解析 · 状态（运行中 k/M / 已完成 / 空闲）   →   ③ 已入库 · X 期 Y 条
```
- N = pending 载荷暂存条目数；② = parse_state（含运行进度）；X/Y = fetchReviewHistory 汇总（published>0 期数与条数，挂载时取一次）。
- 运行中②段呼吸点标 + 进度。

### F. 运行中交互细节
- 「运行解析」按钮 running 态禁用（显示「解析中 k/M…」）；ParsePanel 显示进度与已用时长（startedAt 起算）。
- PublishBar 照常可用（入库与解析写不同行集，D1 batch 串行无冲突）；不额外加锁，仅预览行在 running 时提示「解析进行中，建议可能未出全」。

## 执行步骤

1. **worker（票 13-01）**：迁移追加 parse_state；ctx 线程化；POST /api/parse 异步化 + 409 守卫 + onProgress；pending 载荷扩展 parse 字段；纯函数（状态判定 parseBusy(stale 阈值)、payload 组装）红→绿；curl 验收（启动秒回/轮询可见进度/409/完成态）。
2. **前端（票 13-02）**：轮询 hook（3s，仅 running）+ 数据流标头（stepper 计数纯函数红→绿）+ ParsePanel 运行态（进度/已用时长/禁用）+ 409 处理 + 刷新恢复；FRONTEND_DESIGN §4.12 修订（作业状态语言）。
3. 验证：四门禁；浏览器走查（启动秒回、刷新后状态仍在、双启动 409、完成自动停轮、标头计数对账）。

## 边界

- 不做解析取消按钮（陈旧自愈 10 分钟已兜底）；不做多轮并发队列（单行状态即串行）；不做 WebSocket/SSE（3s 轮询足够）；publish 不加解析互斥锁。

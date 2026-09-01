# Review · spec12 审核台收件箱化（2026-09-01，两票 subagent + 主会话补丁，主会话验收）

**结论：PASS**（P2 两项：一项走查发现已修，一项已知边界记录）

## 交付与验收证据

- **票 01 worker**：sync 响应 `stagedItems`（实测 20 == D1 COUNT）；`GET /api/review/history`（assembleHistory 10 单测红→绿；403/200 两态；limit 三态；对账两期五值一致，含 2099 无条目期补零）。
- **票 02 前端**：`categorizePending` 5 单测红→绿；审核台五块浏览器走查全过：
  1. 状态条「待解析 1 · 已解析待确认 8 · 无需解析 11」——与 D1 对账吻合（20 条暂存、9 条需解析、8 有建议、1 缺候选、11 单家）
  2. 解析常驻区：localStorage `juya-last-parse` 写入与展示（最近解析 09-01 23:48 · 成功 0 · 候选 0 · 余量 0）
  3. 三态分组条目区：待解析组排最前；Runway 条目行内「候选公司：Runway（待入册）」；已解析组「现状 vs 建议」逐归属 role 下拉可编辑
  4. 入库预览：「将入库：2 期 · 20 条（建议生效 8 条 · 无建议 12 条按当前归属直接入库）」+「确认入库（20 条）」——12 = 11 单家 + 1 缺候选，对账吻合
  5. 同步历史折叠区：8 期倒序、成败点标、同步时间、条数、入库状态（08-28 22 条已入库 / 08-31 4 条待审核 / 09-01 16 条待审核）；「展开条目」实测拉取条目清单（aria-expanded 翻转、标题在册）；「查看日报」链接在
- Header 同步条：文案分支与「查看审核」链接（代码审读；浏览器端 5s→15s 窗口未逐帧验证，逻辑简单）。

## 主会话走查补丁（P2，已修）

- **缺公司候选重复调 LLM**：走查发现 missing_owner 条目（候选已提议、公司未入册）每次「运行解析」都被重新圈题调 LLM。修复：`selectParseTargets` 增 `candidateHandledIds` 跳过闸门（company_candidates.source_item_id 命中即跳过），2 单测红→绿；实测 parse `processed:0, remaining:0`（全部已处理零调用）。

## 已知边界（记录，不立项）

- **P3**：历史区「展开条目」走公开 /api/items（仅 published=1）——未入库期显示「该期暂无公开条目」提示；该期条目在审核台主区本来完整可见，不双写。
- **P3（契约差异，兼容处理）**：/api/review/pending 未返回 enrichState（前端以 owners===0 && 无 proposal 等价判定）；ParseOutcome.errors 为 string[]（展示层解析）。
- **P3**：历史行「同步时间」用 attempted_at UTC 截取展示（与 dashboard 同约定）；本地时区换算属展示层远期打磨。

## 门禁

vitest 309 全绿（新增 history 10 + categorizePending 5 + candidate-skip 2）/ 双 tsc 绿 / eslint 0 error（18 既有范式 warn）/ build 46 页。

## 无后续票

无 P0/P1。

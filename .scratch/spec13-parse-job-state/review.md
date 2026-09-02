# Review · spec13 解析作业状态化 + 数据流可视化（2026-09-02，两票 subagent + 主会话走查补正，主会话验收）

**结论：PASS**（P2 一项走查发现已修；四条时序路径全部实测闭合）

## 交付与验收证据

- **票 01 worker**：parse_state 单行状态表（迁移 + 幂等引导，18 项单测红→绿）；POST /api/parse 异步化（curl 时序五步：A idle 载荷 / B 秒回 0.119s / C 完成态 / D running 再 POST→409 parse_busy / E 陈旧自愈重跑）；pending 载荷增 parse 字段（idle 归一 + errors 容错）。**基建发现**：wrangler `d1 execute --file` 为整体原子事务——迁移重跑会回滚增量，引导命令已写入迁移文件头注释（对部署日 D1 初始化有直接指导意义）。
- **票 02 前端**：轮询状态机（shouldPollParse/parsePollStopRefresh 纯函数，10 单测红→绿）四路径齐备；FlowHeader 三段标头（flowCounts 纯函数 + 呼吸点标 CSS，reduced-motion 关停）；ParsePanel 运行态（禁用按钮/进度/已用时长）。
- **浏览器实测（主会话，8787 新代码 + 3000）**：
  - FlowHeader：①已同步 · 暂存 16 条 → ②解析 · <状态> → ③已入库 · 8 期 121 条，点击滚跳按钮在
  - **刷新恢复**：置 running → 刷新 → 按钮「解析中 1/3…」禁用 + 标头「运行中 1/3 ●」——运行态完整恢复（用户核心诉求闭环）
  - **完成停轮**：D1 还原 done → 3s 轮询收敛 → 按钮恢复「运行解析」、标头回「已完成」
  - 409/陈旧路径由 worker curl 证据覆盖（浏览器重放需双实例，不重复造）

## 主会话走查补正（P2，已修）

- **「待解析」标签与引擎语义脱节**：走查发现缺候选待入册的条目（候选已提议、等人工入册）被状态条标为「待解析」，点解析却 total=0——重演「没反应」困惑。修复：categorizePending 拆第四态 `blocked`（missing_owner 且候选已提议），状态条与条目区独立朱橙组「缺候选待入册 N」，与解析跳过闸门（spec12）语义对齐。1 新单测 + 5 断言更新，红→绿。

## 契约差异（兼容处理，记录）

- processed/total/remaining 为 number|null（idle 全 null）——前端 `?? 0` 全链路容错；409 响应体的 state 由前端 409 后重拉 pending 等价获取；parse 时间戳 ISO（前端兼容 ISO 与 UTC naive 两种）。

## 门禁

vitest 335 全绿（+parse-state 15 + 轮询/标头 10 + blocked 1）/ 双 tsc 绿 / eslint 0 error（18 既有范式 warn）/ build 46 页。

## 无后续票

无 P0/P1。解析取消按钮（陈旧自愈 10 分钟已兜底）与 SSE 推送（3s 轮询足够）维持边界外。

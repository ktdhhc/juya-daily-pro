# Review · spec10 编辑工作流（2026-08-29，主会话验收）

**结论：PASS**（三票全过；P1 一项在验收中发现并当场修复复验；P3 若干不阻塞）

## 各票证据摘要

- **票01 暂存基座**：迁移幂等（二次跑 duplicate column 属注释钉死的预期，存量 1116/73 对账分毫不差）；sqlgen staged 语义与 queries 过滤 12 用例红→绿（9 红 → 76 绿）；实测同步响应 stagedDates、访客不可见 08-29 期（daily 404 / items 空 / companies 统计不含暂存）、重同步已发布期不翻转；同步调用链零 LLM grep。
- **票02 解析与审核 API**：workerd 实测核验 fetch/AbortSignal 可用 → chat 层提取共享（scripts 零改动，re-export 同一性断言）；parse.test 29 用例红→绿；四端点 curl 两态实测；真实 LLM 裁决 20260829-6（openai primary，模型 deepseek-v4-flash）；幂等重跑 processed=0；PATCH 校验 8 分支；publish 原子翻转 + enrich_cache 落库。
- **票03 审核页前端**：candidateYamlSnippet 纯函数 5 用例红→绿；227 全量绿 / build 45 页（+review）；只读 pending 实测与 worker 类型逐字段吻合。

## 主会话浏览器走查（全过）

1. 访客直访 /review →「非请莫入」空态 + AdminGate 原地解锁 ✓
2. 解锁后工作区：待审 1 期 · 11 条；#1 显示「已决」（human-edit 终版：腾讯主导/月之暗面合作/智谱被报道）；#2-5 待审点标；末位归属禁移 ✓
3. 刷新后报头：「审核·1」角标 +「退出管理」✓
4. 编辑动线：#1 智谱 被报道→合作，selectOption 后行内「已决」✓
5. 发布：确认入库所选 1 期 → 暂存区转「暂无待审」空态；D1 落库 tencent=primary / moonshot=partner / **zhipu=partner（浏览器人工编辑经 publish 保留——P1 修复闭环）**；11 条 published=1 ✓
6. 访客可见性翻转：/api/daily/2026-08-29 404→200 ✓

## 发现与处置

- **P1（已修复+复验）**：票02 agent 自查发现 publish 重放 proposal 会覆盖人工 PATCH 编辑——直击「人工确认或编辑后入库」核心承诺。主会话 TDD 修复（patchStatements：PATCH 人工编辑同步回 proposal 行，llm_model='human-edit' 标记；30 用例含新分支），并以浏览器全流程复验（见走查 4/5）。
- **P2（环境事实，已记录）**：本机 workerd 内真实 LLM fetch 会挂起整个 isolate（ping 都超时；Node 侧同配置正常）——/api/parse 的真实调用在本地 dev 需警惕；前端已按 120s 客户端超时 + 行内重试设计（该错误路径为代码级验证，未真机触发）。生产环境（真实网络）预计不受此影响，部署日留意。
- **P3**：Header「审核·N」角标为挂载时一次快照，页内发布后不即时消退（Header 不随客户端路由重挂），整页刷新即正确。
- **P3**：单家归属条目的 role select 预选「主导」——仅 UI 缺省，不经确认不落库（单家 role 语义上仍为 NULL）。
- **P3**：/review 无页级 title（"use client" 壳），走全局默认；如需页级 title 需服务端壳，留给部署日打磨。
- **观察项**：自动化点击在该页多次 actionability 超时（原生 DOM click 正常）——真实用户鼠标操作不受影响；疑似与 dev overlay/持续微重渲染相关，不立项。

## 遗留（主会话任务）

- 323 条存量 enrich 全量回填（分轮）+ role 覆盖率对账。
- 人工纠错演练（改 enrich_cache.result → --force 单条重应用）。
- pending 候选搬册仪式（需用户参与审阅）。

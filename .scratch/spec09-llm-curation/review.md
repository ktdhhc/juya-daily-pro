# Review · spec09 LLM 数据整理（2026-08-29，主会话验收）

**结论：PASS**（三票全过；P2 一项为流程记录，无 P0/P1；存量回填全量跑由主会话另行执行）

## 各票证据摘要

- **票01 LLM 接入层**：parseEnvText/resolveLlmConfig 9 用例红→绿；映射表（LLM_BASE_URL→baseUrl→wrangler LLM_API_BASE 回退；MODEL_NAME→model→LLM_MODEL；LLM_API_KEY 无回退缺失即 throw 含「检查 .env」）；全量无回归。
- **票02 enrich 存量回填**：agent 在收尾阶段因派工通道故障死亡（实现已完成），主会话接手验证——19 用例（prompt 快照/截断边界/parse 6 分支/deriveRoles 三样本）+ sqlgen COALESCE 语义断言。**变异验证**：反转幻觉 id 校验 → 4 用例失败，还原复绿（替代丢失的红证据）。真实抽验 `npm run enrich -- --limit=3`：3/3 成功（xAI/OpenAI/DeepSeek primary 判例，reason 人工可读），SQL 核验 primary 100% ∈ 候选集。
- **票03 候选公司提议**：14 用例红→绿（三分类/幻觉 parent→null/slug/非法 JSON/截断边界）；真实一轮（--limit=40）：company 27→去重 23 条入 pending（含 source 溯源）、product 5（parent 全部 ∈ 在册——幻觉校验生效）、ignore 7、失败 1（超时下轮重试）；`data/companies.yaml` 与 `registry.generated.ts` 零修改。

## 发现

- **P2（流程记录）**：票02 的红证据随 agent 故障丢失，以变异测试替代证明测试有效性（4/19 用例对幻觉校验分支敏感）。后续票面已含「先红后绿贴双证据」要求，agent 中断后主会话接手时统一用变异法兜底。
- **P3**：enrich 单条失败留待下轮自动重试（20260630-15 超时）——设计如此（幂等圈题跳过已有 cache），无修复必要。
- **P3**：product 判别结果只计数不落库，parent alias 建议仅出现在报告文本——信息量足够，待 spec10 审核页若需要可回填。

## 数据基线变化

role 分布首现分层：primary=3 / partner=2 / subject=4（NULL=1476→1476，存量回填全量跑后 NULL 大幅下降）；missing_owner 128（pending 23 条候选入册后将下降）。

## 后续（主会话任务，不阻塞提交）

- 323 条全量回填分轮执行（MAX_LLM_PER_RUN=20/轮）+ role 覆盖率 ≥95% 对账。
- 人工纠错演练（改一条 enrich_cache.result → --force 单条重应用）。
- pending 文件的人工审阅搬册仪式（用户参与）。

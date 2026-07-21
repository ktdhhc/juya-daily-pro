# LLM enrich 任务收窄：只判 primary，partner/subject 交启发式补

## Context

ADR-0003 定了"白名单做候选集，LLM 在多家时定 role"。落地时 LLM 任务设计有两种极端：

- 让 LLM 同时输出每家公司的 role（多分类）：实现最简，但中文多分类在多家时易乱
- 引入 confidence 字段：让低置信度 item 暂时不显示 role，但 LLM 自评的 confidence 自身不可靠

## Decision

LLM 任务**收窄到单分类**：

- **LLM 只回答"谁主导"**：输出 `{primary_company_id, reason}`，不输出 partner/subject/confidence
- **partner / subject 用确定性启发式补**：
  - title 里"与/和"连接两家白名单公司 → 前者为 primary（LLM 给的）、后者为 partner
  - 仅在 body 提及、不在 title → subject
  - title 里两家都被提及但无"与/和"连接 → 都视为 primary 候选，由 LLM 挑一家，另一家 subject
- 结果写 `enrich_cache`：`{primary_company_id, reason, llm_model}`
- 同一 item 重跑时 cache 命中即不再调 LLM

## Why not the alternatives

- LLM 输出全 N 家 role：多分类在三家+时易出"全 primary"或"全 subject"这种异常；中文标题里事件主动方判定本来就是单选题（一个事件多半只有一个主导方）
- 引入 `confidence` 字段：LLM 自评不可靠（"经常自信地说错"），低阈值难调（高则大量 pending、低等于没有），且无法替代真正的边界判定

## Consequences

- LLM 任务从"N 分类"降为"1 选 1"，稳定性显著提高，prompt 简短
- 启发式判定 partner/subject 在中文边界还会偶尔出错（如"与/和"分词失败），但错误可见、不阻塞、可在 `enrich_cache` 手工覆盖
- `enrich_cache.result` 字段结构为 `{primary_company_id, reason, llm_model}`，不是 ADR-0003 原始设想的 `[{companyId, role, reason}]`——schema 微调，不影响其它 ADR
- 决策透明：用户可在公司页看到"primary 由 LLM 判定（理由）、partner/subject 由启发式补"这种混合来源标注（如有必要），但 MVP 不显式标注
- 三家+白名单公司同条时 LLM 仍有歧义，单分类会让有些"双主导"事件强行被一家独占 primary——接受这个简化代价
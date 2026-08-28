# Item 公司归属：白名单候选 + LLM 仅在多候选时定 role

> **修订 2026-08-28（ADR-0014）**：v1 仅执行本文段一；段二（LLM 定 role）后置为部署日后的离线批量回填任务，v1 多家归属并列、role 全 NULL。段一规则不变。

## Context

Item 的 `owners[]` 既要能"按公司捋清信息"，又要符合 Company Registry 作为闸门的设计（ADR 0001）。归属字段需要回答两个问题：

- 一个 Item 涉及哪些白名单公司？（"是不是这家公司"的判定）
- 多家公司时各自是什么 Role？（"主次关系"的判定）

这两个问题难度差异巨大：前者是字面量/别名正则匹配几乎不会错；后者是事件语义理解，规则启发式在"标题主语法"、"标题无仅正文提及"、"与+主语分词"等中文边界都会失稳。

## Decision

归属解析分成两段，职责分明：

- **段一（确定性）**：在白名单 `aliases[]` 上对 Item 的 `title + bodyMd` 做匹配，得到候选公司集合 S。同一公司的多个别名命中内部去重。`|S| <= 1` 时直接出 `owners[]`（单家归属 role 缺省；空集合即"归属缺失" Item 仍合法）。
- **段二（LLM 辅助，仅当 `|S| >= 2`）**：把 `title + summary + bodyMd` 与候选公司列表喂 LLM，输出每家公司的 `role`（`primary` / `partner` / `subject`）+ 一句理由。结果缓存到 `data/enrich-cache.json`（key = item.id），手工可改写回。

## Why not the alternatives

- 纯别名字面量匹配且多家时不分 role：`#12`（白宫被指掌控前沿 AI 模型访问权限，正文叙述到 Anthropic 与 OpenAI 但两家都不是事件主角）会被错判为 primary/partner，污染公司页主次关系。
- 纯规则启发式定 role（标题主语 → primary、找"与"连接 → partner）：中文"与"分词不稳；标题完全不提的多家被提及场景规则无法覆盖。
- 每条都喂 LLM 做白名单挑选：与 ADR 0001"白名单是闸门"冲突，等于 LLM 是闸门；且 token 量与出错半径都更高。

## Consequences

- LLM 只在少数"多家白名单公司同时出现"的 Item 上被调用。粗估占比 < 15%，剩余条目零 token。
- enrich 流程是可重入的：在 cache 上覆盖一条 LLM 结果即可改写，不需要全量重跑。
- "归属缺失" 的 Item（S = ∅）不会因 LLM 而被强行指派公司，保持白名单闸门的有效。
- Long tail：若 Item 同时提及三+家白名单公司，LLM 出错风险随候选数加大，需要单条结果在 cache 中可手工改写。MVP 阶段先接受这个风险。
# Company Registry 维护待办

## 别名撞车
- `Copilot` 同时出现在 microsoft 和 github 别名里。Enrich 阶段优先匹配更具体的 alias（GitHub Copilot → github；Microsoft Copilot → microsoft）。
- `Hero` 类共用名暂未列入白名单。

## 入册门槛（v0）
建议默认拒绝 LLM 提议的候选，仅在我手动确认后入册。LLM 输出落在 `data/companies-pending.yaml`。
# Company 归属策略：白名单闸门 + 多对多仅在多家时启用

## Context

Item 是本项目数据原子单位。最初的"按公司捋清信息"诉求要求把每个 Item 打到公司标签上，方案讨论中浮现了两类风险：

- 全实体抽取会把"Nvidia 与日本巨头合作建设 AI 基础设施"里的软银、丰田、Noetra 等也标为参与公司，导致公司页充斥"行业配角"。这与项目目标"捋清科技/AI 公司动态"不符。
- 一对一归属（单主公司）会让"Anthropic 或向 Meta 租赁算力"这种两家白名单公司都在的事件丢失一方关系。

## Decision

维护一份 **Company Registry**（白名单）：只有登记在册的"活跃科技/AI 公司"才会被标到 Item 上。一条 Item 上 Company 归属的规则为：

- 抽取到的白名单公司数量为 0：Item 仍然存在，归属字段为空（归属缺失 ≠ 条目缺失）。
- 为 1：单对一单归属。
- ≥ 2：多对多，每家公司带一个 Role（`primary` / `partner` / `subject`）。

白名单的诊断、提议新增由 LLM 完成（输出到候选清单），但**入册必须由人工确认**，避免 LLM 把"任何被提及的实体"都拉进白名单导致闸门失效。

## Why not the alternatives

- 全实体抽取：信息保真但白名单无限膨胀，违背"只关心活跃科技/AI 公司"的初衷，公司页排序也失去意义。
- 一对一单主公司：实现简单，但多公司合作事件在次主公司页面消失，违背"按公司捋清信息"。
- 多对多但无 Role：丢失"谁主导谁参与"，公司页排序与"谁是主角"这种细分过滤无法实现。

## Registry 单一事实来源

`data/companies.yaml` 是 Company Registry 的唯一真相，D1 `companies` 表是其只读镜像：

- 维护流程：编辑 `data/companies.yaml` → 提 PR → 合并触发 Worker redeploy
- Worker 构建阶段把 `companies.yaml` 编译成 TS module 打进产物；Worker 首次 `scheduled` / `fetch` 调用时幂等 upsert D1 `companies` 表（按 `id` 唯一约束）
- LLM 提议新增候选写到 `data/companies-pending.yaml`（**不**进 D1），等人工 review 后搬进 `companies.yaml` 并入册
- 所有读 API 从 D1 `companies` 读，避免运行时解析 yaml
- git 历史即白名单审计日志
- 你只需 `git push` 即可更新白名单，无需额外 `npm run` 步骤

## Consequences

- 一批"行业配角 × AI 合作"事件会显示为单公司（仅主角的白名单公司被记录），副角公司页缺失该条——这是有意为之的设计取舍。
- 白名单本身会因为新公司持续涌现而过时，需要走"LLM 提议 → 人工入册"的维护流程。入册门槛应偏严：宁可漏掉边缘候选由后续审核补，也不放宽到"被报道一次就入册"。
- "归属为空"的 Item 仍然是合法 Item；公司视角过滤时会隐藏它们，但事件流与日期页照常可见。
- 白名单变更必须走 PR，无法在运行时直接改 D1——这是"闸门需人工确认"的强制落地。
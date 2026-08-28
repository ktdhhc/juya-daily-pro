# `/stream` URL 编码 facet 筛选状态

> **修订 2026-08-28（ADR-0014）**：`/api/items` 分页已从 cursor token 改为按期分页 `?before_date=YYYY-MM-DD`。本文核心决策不变——URL 仍只编码 facet，`before_date` 属于加载位置、留在 JS 内部状态、不进 URL。

## Context

`/stream` 视图的 facet 筛选（按公司 / 分类 / 日期范围）需要一种共享机制——用户在"Anthropic 模型发布近 30 天"这种切面找到有价值的视角后，希望能把 URL 分享给他人直接复现。但是否把 cursor 分页位置也编码进 URL 是个真实取舍。

## Decision

`/stream` URL 只编码 facet 状态、不编码 cursor 分页位置：

- `?company=anthropic&category=模型发布&from=2026-07-01&to=2026-07-21`
- 接收方打开即按该筛选重新从近 7 天 fetch、自然下划加载更早
- cursor 留 JS 内部状态、不污染 URL

## Why not the alternatives

- **完全不编码、URL 只反映视图本身**：用户无法分享筛选好的切面，与 user story `按公司捋清信息`诉求严重冲突。
- **完整编码 facet + cursor**：分享一条链接对方直接看到同样的列表起点；但 cursor 写进 URL 会让对方在打开时落到列表中部而非首屏，体感怪异、且与"事件流首屏默认近 7 天"原则冲突。
- **编码所有 facet（含默认值）**：URL 冗长。

## Consequences

- 类别 URL 与 ADR-0007（`/api/companies/:id` 档案头）保持一致——公司页与事件流的"可分享切面"是同一种形态。
- 前端实现需把 facet 状态与 URL query 双向同步（改 facet 改 URL，改 URL 改 facet）；与已有"日期阅读页 ?date= 同步"模式一致，复用 `DailyPage.tsx` 中 popstate 监听范式。
- 服务端 `/api/items` API 接受 `company / category / from / to` 四个 query 参数，不复用 cursor 字段作 facet。
- 与 ADR-0008 sync 容错下"facet 改变即清空已加载"一致——刷新 URL 也即清除当前 cursor、按新 facet 重 fetch。
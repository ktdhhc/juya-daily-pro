# Spec 12 · 审核台透明化（收件箱化）

> 来源：2026-08-31 用户反馈——三段制「做到了但极其模糊」：不知道同步了什么、有什么待解析、失败为什么、即将入库什么。上游：spec10（编辑工作流）、spec11（重解析通道）。
> 定位：/review 从「能操作」升级为「每一步可见、可查、可重试」的收件台。零 LLM 单测（ADR-0011）。

## 契约（钉死）

### A. sync 响应增条数
`POST /api/sync` 响应增加 `stagedItems: number`（同步后 `published=0` 的条目总数；stagedDates 语义不变）。Header 成功条文案：`同步 N 期 · M 条待审核`（M=0 时省略后半）+「查看审核」文字链跳 /review（成功条保留时长延长到 15s）。

### B. 三态分组（/review 条目区重组）
`GET /api/review/pending` 载荷不变；前端纯函数 `categorizePending(items)` 把暂存条目分为三组（组序即渲染序）：
1. **待解析**（enrich 缺建议）：owners≥2 且无 proposal，或 enrich_state='missing_owner'
2. **已解析待确认**：owners≥2 且有 proposal
3. **无需解析**：owners≤1 且非 missing_owner
每组标题带计数；组内条目行不变（ProposalEditor 照旧）。

### C. 解析结果持久化
「运行解析」的响应整体存 `localStorage['juya-last-parse']`（`{ at, processed, candidatesFound, remaining, errors: [{itemId, error}] }`），审核页**常驻**展示最近一次结果：成功 N 条 / 候选 M 个 / 余量 R；errors 逐条列出「itemId · 原因」；`remaining>0 或 errors 非空` → 「再跑一次」提示（解析幂等，只处理剩余）。解析成功清零后错误清单自然消失（被新响应覆盖）。

### D. 入库预览
PublishBar 勾选变化时实时显示：`将入库：N 期 · M 条（建议生效 K 条 · 无建议 L 条将按当前归属直接入库）`；确认按钮文案带数量「确认入库（M 条）」。

### E. 缺公司候选关联提示
missing_owner 条目行内显示「候选公司：`<name>`（待入册）」——数据取 pending 载荷中 source_item_id 指向该条目的首个候选（assemblePending 已有 candidate 字段，补条目行渲染）。

### F. 同步历史与解析后日报回看
新端点 `GET /api/review/history?limit=30`（requireAdmin，不进缓存）：
```json
{ "history": [ { "date": "2026-09-01", "status": "ok", "error": null, "attemptedAt": "2026-08-31 15:28:47",
                 "items": 16, "published": 0, "attributed": 14 } ] }
```
- 行源 = sync_log 最近 30 条（按 attempted_at 倒序）；逐期 LEFT JOIN items 统计：条目数、published=1 计数、enrich_state='ok' 计数（无条目期统计为 0）。
- 纯函数 `assembleHistory(syncRows, statRows)` 合并（spec：无条目期 published/attributed=0）。
- /review 底部「同步历史」折叠区：每行 日期 / 成败 / 同步时间 / 条数 / 入库状态（published>0 →「已入库」，=0 且 items>0 →「待审核」，items=0 →「无条目」）；失败期显错误原因；行内「展开条目」拉取该期条目清单（复用 /api/items?date=，展示 标题+分类+归属徽章带主次）+「查看日报」链接（/?date=）。默认折叠，展开懒加载。

## 执行步骤

1. worker（票 12-01）：syncNow 响应加 `stagedItems`；`buildHistoryQuery` + `assembleHistory` 纯函数红→绿；路由挂载；curl 验证（shape + 与 D1 对账）。
2. 前端（票 12-02）：`categorizePending` 纯函数红→绿（三态分组/组序/missing 归待解析）；/review 重排（状态条 → ParsePanel 常驻结果 → 三态分组 → PublishBar 预览 → 同步历史折叠区）；Header 同步条文案与链接；FRONTEND_DESIGN §4.12。
3. 验证：四门禁；浏览器走查（三态计数对账 D1、解析错误展示与重试提示、入库预览数字、同步条跳转、历史区展开与对账）。

## 边界
- 不做解析错误服务端持久化（localStorage 即可——审核是单管理员本机动作）；不改 parse 圈题逻辑；不做逐条单条重试按钮（「再跑一次」全量幂等已覆盖）。

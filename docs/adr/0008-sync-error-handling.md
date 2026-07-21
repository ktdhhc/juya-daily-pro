# 同步错误处理：单期容错 + sync_log 透明化

## Context

daily.juya.uk 由 AI 辅助创作，作者已在每期末尾声明"内容可能存在幻觉与错误"。parser 必然会遇到：结构异常（缺 # 概览 / 缺 #N 编号 / 摘要空）、某期 archive 列出但 markdown 404、日期完全跳过等。早期数据源还发生过迁移。

## Decision

cron sync 采用**单期独立、容错前进**：

- 每期处理独立 packaged try-catch；一期失败不影响同期别的其它期
- R2 抓不到 markdown / 解析抛错 → 写 `sync_log` 一条记录 + 跳过该期，继续下一期
- 解析半成功仍入库：
  - 缺 `>` 摘要 → `summary` 留空字符串
  - 缺 `#N` → `tag` 留空
  - 相关链接块缺失 → `related_links` 空数组
  - 上述任一发生 → `enrich_state = "pending"`（即使没公司归属也会被前端 graceful 渲染而非隐藏）
- `sync_log` 表最小字段：`date / attempted_at / status / error_message`，可查询出"哪些期出过问题、何时"供人工 review

## Why not the alternatives

- 严格 fail-stop：一个长尾异常会阻塞整轮 cron，坏数据像黑洞吸收后续所有同步；与"juya-daily 本身就含噪声"的现实不符
- 严格 + 告警：MVP 阶段不值得 Worker Email Routing / Discord webhook 这套基建

## Consequences

- D1 会有少量残缺 Item，前端必须 graceful 渲染（空摘要回退到正文首句或显示"—"占位）
- `sync_log` 表会持续增长，需要定期人工清理或加保留策略（MVP 不做）
- 同一期重试成功时不写第二条 log（用 `date` 唯一约束 + UPSERT）
- 前端 enrich 缓存 (`enrich_state`) 区分"待 enrich"与"残缺待人工"靠同一字段，不引入额外状态
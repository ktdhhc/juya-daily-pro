# 公司页档案头与 `/api/companies/:id` 响应形状

## Context

公司页 `/company/[id]` 是"按公司捋清信息"的核心视图，顶部档案头是该页信息密度最高的区域。档案头要同时回答：身份、活跃度、性质画像、行业关系、数据覆盖——五个不同问题。

## Decision

公司页档案头固定包含五块，每块直接对应 `/api/companies/:id` 一个响应字段：

1. **基础**: `name` + `color` 徽章 + `notes` 一句话定位 + `aliases[]` 小字（"又名 Claude、Fable"）
2. **事件统计**: `stats.total`、`stats.last30d`、`stats.lastEventDate`
3. **分类分布**: `stats.categoryDistribution` `{ category: count }`
4. **关联公司**: `stats.coworked[]` `{ companyId, name, color, count }`（按共同出现次数倒序，最多 8 家）
5. **时间跨度**: `stats.earliestDate`、`stats.latestDate`

## Why

每条都几乎零额外成本——D1 一两行聚合 SQL 即可（关联公司是自 join `item_companies` 一次）。每条解决一个不同的"按公司捋清信息"的子问题：身份、活跃度、性质画像、行业关系、数据覆盖。任一缺失都形成明显信息断点（如丢关联公司就丢"谁和谁经常一起"的网络感）。

## Consequences

- `/api/companies/:id` 响应包含 `stats` 块，是 D1 多条聚合查询的合成结果。Worker 内可加 60s `caches.default` 缓存，避免每次访问都重算
- 关联公司是 N×N 自 join 查询；白名单公司数可控（< 200），MVP 不做冗余缓存表
- 若未来公司数破千，需引入 `company_cowork_counts` 物化表（MV）由 cron 维护——本期不做
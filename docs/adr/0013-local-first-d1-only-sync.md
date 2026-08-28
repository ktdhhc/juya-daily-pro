# MVP 本地优先：D1 单存储引擎 + 手动同步，Cloudflare 部署整体后移

## Context

MVP 的构建方式确定为长程 agent 无人值守推进（goal 模式多轮自动迭代），验收形态是"本地可用"先于"公网部署"。原方案（ADR-0005 / 0006 / 0010）把 R2 归档、cron 自动同步、Pages 部署绑在关键路径上，带来三个问题：

- 建表、回填、API 调试每个阶段的验证都需要 Cloudflare 登录态（`--remote`）或部署态，人在环节点会把无人值守长跑反复打断；
- R2 + D1 双存储、cron 触发的验证都要跨系统对账，agent 自主验证成本高；
- 原文归档量 ~30KB/天、一年 ~11MB，远低于 D1 限额，R2 在此量级没有不可替代性。

## Decision

1. **原文归档改存 D1 `sources` 表**（`date` TEXT PK + `markdown` 原文）：审计回放与 schema 变更后的全量重解析都从 `sources` 读。D1 成为唯一存储引擎（六张表：items / companies / item_companies / enrich_cache / sync_log / sources）。部署日若评估需要 R2，从 `sources` 导出即得，无迁移成本。
2. **同步逻辑做成共享模块**（`worker/sync/`），暴露两个薄入口：
   - 本地手动增量同步：`npm run sync`（v1 的日常同步方式）；
   - Worker `scheduled` 入口：一行挂载同一模块，部署日启用 cron 后才生效。
   v1 不部署 cron，`wrangler.jsonc` 的 `triggers.crons` 留空。
3. **本地全链路零 Cloudflare 登录**：D1 用 wrangler 默认本地模拟（miniflare）建表 / 回填 / 查询；`wrangler dev --remote` 仅部署日联调使用。
4. **部署整体后移到可选的阶段 6「部署日」**：Cloudflare 登录、生产 D1（及可选 R2）、Worker deploy、cron 启用、Pages 部署与 `/api/*` 同域代理，集中在一次人在环会话完成。
5. **首页 `/` 维持直连 daily.juya.uk 现状**：迁移到 `/api/daily/:date` 后移到部署日（ADR-0004 "`/` 现状不变"因此继续成立，"看原期"锚点 `?date=` 不受影响）。v1 接受首页（实时源）与事件流/公司页（D1）的临时口径差，部署日统一。

## Why not the alternatives

- **维持 R2 + cron + 部署在关键路径**：每个阶段的验证都依赖凭据与部署态，长程构建被人在环操作反复切块，与"无人值守跑到本地可用"直接冲突。
- **原文存本地文件系统**（`data/archive/*.md`）：读取路径脱离 Worker 运行时形态，部署日仍要改一次读源逻辑；且绕开 D1 后备份变成两套。
- **v1 就迁移首页到 read API**：三新视图不依赖首页迁移，提前做只会在关键路径上增加"旧阅读体验被改坏"的风险面。

## Consequences

- `worker/sync/schema.sql` 增至六张表（阶段 2 落地 `sources`）。
- ADR-0005（R2 归档、cron 写入、Vectorize 二期）、ADR-0006（cron 与 LLM/R2 参数时机）、ADR-0010（`--remote` 默认、生产部署）按本文修订；ADR-0008 的单期容错语义原样适用于 `npm run sync`。
- 文档与代码中出现的"cron / 北京 08-11 半点 / 6 次/天"均为部署日行为，v1 不生效。
- 白名单生效路径变为：改 `companies.yaml` → git 提交 → 下次 `npm run sync`（或 Worker 首次调用）幂等 upsert D1；"git push 触发 redeploy"推迟到部署日。

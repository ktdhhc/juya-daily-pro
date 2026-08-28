# 归属与检索 v1 简化：单段确定性匹配、LLM enrich 后置、砍 RAG、按期分页

## Context

以"无人值守跑到本地可用"为验收形态重新审视三个设计：

- LLM enrich（ADR-0003 段二 / ADR-0009）是 MVP 中唯一非确定性、依赖外部凭据、验证需人在环的环节，而它的产品价值仅是多家徽章的主次视觉区分；
- RAG / Vectorize（原路线 Phase 3）面向的数据量是几千条 Item（一年 ~11MB 原文），向量检索在此量级的收益撑不起 Vectorize index、embedding 流水线、配额限流三个新增子系统；
- `/stream` 的加载单位是"期"（滚动到底自动加载更早一期），Item 级 cursor token 属于过度设计。

## Decision

1. **v1 归属只跑段一（确定性白名单匹配，规则与 ADR-0003 段一完全一致）**：
   - `|S| = 1`：单归属，role 缺省（NULL）；
   - `|S| ≥ 2`：并列归属，role 全部 NULL，渲染并列徽章、不分主次；
   - `|S| = ∅`：归属缺失，`enrich_state=missing_owner`，条目照常入库（不变）。
2. **LLM enrich 整体后置为「部署日后的离线批量回填」任务**：复用 ADR-0009 的任务设计与 `enrich_cache` 表（schema 原样保留），回填脚本把 role 写入 `item_companies.role`。v1 与回填共用同一 schema，无需迁移；`companies-pending.yaml` 的 LLM 提议流程随回填一并启用。
3. **RAG / Vectorize / `/ask` 整体裁剪出路线图**；检索需求由全文检索承接（Phase 2 落地时在 D1 FTS5 与客户端 flexsearch 之间定，语料 = `title + summary + bodyMd`）。`bodyMd` 的保留理由相应改为"公司页详情展开 + 全文检索语料"（ADR-0002 的决策本身不变）。
4. **`/api/items` 按期分页替代 cursor token**：`GET /api/items?company=&category=&from=&to=&before_date=&limit=`，`before_date` 表示"返回该日期（不含）更早的 N 期"。与 ADR-0012 兼容：URL 仍只编码 facet，`before_date` 属于加载位置、不进 URL。已提交的 `sequence_int` 保留，用于期内稳定排序。

## Why not the alternatives

- **保留 LLM 段在 v1 关键路径**：引入凭据依赖、非确定性与限流逻辑，验证需真实调用（人在环）；换来的是"徽章略大一点"的视觉差异——投入产出不成立。
- **保留 RAG**：数千条语料下全文检索已能覆盖"Kimi 最近发生了什么"级别的查询；Vectorize 的时间窗口、配额、成本在个人工具场景全是净负担。
- **Item 级 cursor**：为不存在的"日内滚动翻页"设计；按期翻页与"加载更早一期"的 UX 一一对应，实现与调试都更简单。

## Consequences

- ADR-0003 段二、ADR-0009 的执行时机、ADR-0011 的 enrich 相关测试行（prompt 组装 / 启发式 role）后置到部署日任务；ADR-0001 的"多对多带 Role"规则改为"v1 多对多无 Role、回填后生效"。
- v1 事件流与公司页徽章均并列渲染、无主次；"主公司略大、Role 提示"等渲染细节在 enrich 回填后启用。
- 原 Phase 2 的话题聚类、公司简介 LLM 自动生成一并裁剪；Phase 3（RAG）从路线图删除，未来数据量或需求升级再重启并新写 ADR。
- D1 对 FTS5 的支持度需在 Phase 2 开工前验证，备选方案为客户端 flexsearch 索引（零后端）。

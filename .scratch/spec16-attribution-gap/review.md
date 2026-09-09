# spec16 review（两轴，固定点 `bba040a`）

> 固定点：`bba040a`（spec16 全部改动在工作区未提交）。diff 命令：`git diff bba040a`（新文件已 `git add -N`）。
> 两轴各由独立子代理执行（Standards × Spec），本节为汇总；处置见下。

## Standards 轴

**硬违规（已修）**
1. `docs/CURRENT_STATE.md` 未同步（入册通道、API 列表、文件地图、ADR 计数）→ 已更新。
2. `CONTEXT.md` 缺「Company Candidate（临时名单）」词条（spec Further Notes 要求）→ 已补。

**判断提示（处置）**
3. `scripts/registry-apply.ts` 的 `executeSqlFile` 与 `sync.ts` / `match-all.ts` 同款三处重复 → **未修**（P3；收拢到 `scripts/lib/` 属独立重构票，避免本 spec 范围膨胀）。
4. 证据分段编码（`；`）在 worker（上限 5）/ 离线脚本（上限 3）/ 前端（按字面切分）三处各写一份 → **未修**（P3；彻底解法是 API 直接返回段数组，属接口变更）。
5. `runPropose(item, itemId)` 与既有 `MissingTarget` 形状重复（数据泥团）→ **未修**（P3）。
6. `scripts/enrich.ts` 把「合法无主导」记入失败清单（exitCode=1、不入 enrich_cache）→ **未修**（P2；离线回填工具，语义可辩，另行收敛）。

## Spec 轴

**要求缺失/半成品（已修）**
1. 术语与 CURRENT_STATE 文档 → 已补（同 Standards 1/2）。
2. 四张票的验收证据未回填 → 已回填（见文末「验收证据」）。

**范围蔓延（记录不改）**
1. 票 04 步骤②复用 `npm run sync`（除刷新公司镜像+窗口重匹配外还会联网抓期，网络失败会在回填前中止）→ **记录**：sync 是既有唯一"刷新镜像"入口；`registry:apply` 与 sync/match:all 一样依赖网络，属既有约束。

**实现方式（P1，已修）**
1. **闸门只按 `source_item_id` 关联**：候选按公司聚合只保留一个来源条目，同一家缺公司被多条提及时，其余条目不跳过 → 每轮重复 enrich+propose 两跳 LLM，且不进「缺候选待入册」。→ 已修：新增 `itemMentionsCandidateName` 名称兜底（标题/正文命中未入册候选公司名即挂闸门），并新增单测。
2. **闸门只认 pending**：已忽略的候选会让条目重新可解析（用户表态后仍重烧）→ 已修：`buildUnregisteredCandidateSourcesQuery` 收窄为 `status IN ('pending','dismissed')`（已入册才解除闸门）；`registry:apply` 回填同步覆盖 dismissed（人工把公司写进白名单即视为态度改变）。

**记录不改（P2）**
3. propose 裁决 `product`/`ignore` 的条目不产生候选 → 无闸门可挂，每轮重判（pre-existing，与零命中 missing_owner 同款）→ 已在 spec Further Notes 记为已知遗留。

## 验收证据

- **纯函数**：`npx vitest run` 全量 408 用例通过（spec16 新增：enrich 4、parse 14、review 1、registry-apply 8）；`npm run typecheck` 0 错。
- **集成（缝 2，`wrangler dev --test-scheduled` + 读 D1）**：
  - 无主导链路：本地把 `20260909-10`（Inception Labs 发布 Mercury 2.5，候选为 openrouter/google/nvidia/openai）置为暂存并清空其建议 → 触发定时链路 → `item_proposals` 0 行、`item_companies.role` 全 NULL、候选 `inception-labs` 落库（source=该条目）、条目 `published=1`（自动入库不受影响）。
  - 闸门：条目带 pending 候选再次暂存 → 触发 → 日志「无待解析目标，自动入库」、候选数不变（无 LLM 调用）。
  - 端点：非法 status → 400、不存在 id → 400、GET → 405；`/api/review/pending` 载荷含条目→候选关联。
- **UI 走查（1280×900）**：`缺候选待入册` 计数 1 且默认落在该 tab、面板列出 `#10 Inception Labs 发布 Mercury 2.5`；候选区 4 条、按钮全部可用；点「忽略」→ 候选消失、tab 计数归 0（条目转为 unparsed 不在人工 tab，符合既有设计）。`.m-nav` 在 1280px 为 `display:none`（走查中发现本地 dev 文件监听失效在吐旧 CSS，已重启 dev server 修正）。
- **命令演练（票 04，`--local`）**：临时把 `runway` 加入 `data/companies.yaml` → `npm run registry:apply -- --local` → 候选 `runway` 变 `registered`、其 3 条条目挂上该公司、`missing_owner` 135→132；负向：yaml 写坏 color → 步骤① 失败即止（exit 1，②③④ 未执行）。演练后 `data/companies.yaml`、`registry.generated.ts`、本地 D1 全部还原。

## 汇总

- Standards：2 硬违规（已修）+ 4 判断提示（3 记录、1 待收敛）。
- Spec：2 缺失（已修）+ 1 范围蔓延（记录）+ 2 实现方式问题（P1，已修）+ 1 已知遗留（记录）。
- 最严重问题（各轴内）：Standards = CURRENT_STATE 未同步（已修）；Spec = 闸门关联只覆盖来源条目导致重复烧 LLM（已修）。

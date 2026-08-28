# Spec 03 · 确定性白名单匹配（单段，无 LLM）（工程性，线性执行）

> 上游依据：`docs/plans/mvp-build-phases.md` 阶段 3；ADR-0001（白名单闸门）、ADR-0003 段一、ADR-0014（v1 单段、role 全 NULL）、ADR-0008（missing_owner 语义）。
> 本文可按顺序逐步执行。

## 目标

把已回填的 1105 条 Item 与 30 家 Company Registry 做段一确定性匹配：写 `item_companies`（role 全 NULL）+ 回写 `items.enrich_state`（0 命中 → `missing_owner`，≥1 → `ok`）。全程纯函数 TDD + 本地 D1 胶水脚本，**零 LLM、零登录**。

## 前置事实（已核验）

- `src/lib/matchCompanies.ts` 已实现段一：`matchCandidates`（alias 编译：字面量转义 + `/regex/i` 形态正则、retired 跳过、title+\n+bodyMd 大小写不敏感匹配、同公司多别名聚合）与 `ownersByMatching`（0→[]、1→单 owner 无 role、≥2→并列无 role）。**该文件尚无任何测试**。
- D1 现状：items 1105 行（enrich_state 全为 `ok`——真实数据解析全成功）、companies 30 行、item_companies 0 行。
- `scripts/backfill.ts` 内含 `runWrangler` / `parseWranglerJson` 工具——本 spec 抽取为共享模块 `scripts/lib/wrangler-cli.ts` 供两个脚本复用（backfill.ts 同步改为 import，行为不变）。
- spec02 已交付 `worker/sync/sqlgen.ts`（escapeSqlText / upsert 系列）——本 spec 在同文件扩展两张票的 SQL 生成。

## 执行步骤（线性）

### Step 1 — matchCompanies 单测（先红后绿）

`src/lib/matchCompanies.test.ts` 覆盖 ADR-0011 列明的用例：
1. 字面量 alias 命中（title 或 bodyMd 任意位置）
2. 正则 alias（`/…/` 与 `/…/i` 形态）命中
3. 字面量与正则混合 registry 下同时生效
4. 同公司多别名命中 → 聚合为一个 owner（`matchedAliases` 多条）
5. retired 公司不参与匹配
6. 0 命中 → `[]`
7. ≥2 家命中 → 并列 owner 数组、**全部无 role 字段**（ADR-0014）
8. 大小写不敏感（"anthropic" 命中 "Anthropic"）
9. 特殊正则字符的字面量 alias 不被解释（如 "C++" 类含 `+` 的 alias）

若测试暴露实现缺陷：**最小修复**并在汇报点名（不许重构）。预期全绿（实现据信正确），红只应出现在"测试先行"的瞬间。

### Step 2 — sqlgen 扩展（先红后绿）

`worker/sync/sqlgen.ts` 新增：
- `itemCompaniesUpsertSql(rows: { itemId: string; companyId: string }[]): string`——`INSERT INTO item_companies (item_id, company_id, role) VALUES (..., NULL) ... ON CONFLICT(item_id, company_id) DO UPDATE SET role = excluded.role`；空数组 → ""；
- `enrichStateUpdateSql(okIds: string[], missingIds: string[]): string`——两条 `UPDATE items SET enrich_state='ok'|'missing_owner' WHERE id IN (...字面量...)`；空列表跳过对应语句。

测试并入 `worker/sync/sqlgen.test.ts`（沿用既有 expectDiscipline 纪律断言）。

### Step 3 — 共享 wrangler-cli 抽取

新建 `scripts/lib/wrangler-cli.ts`：迁移 `runWrangler` / `parseWranglerJson`（原样搬运，行为不变）；`backfill.ts` 改为 import。验证：`npm test` 与 `npm run backfill --help 不存在没关系`——backfill 行为不变以四门禁 + 幂等无需重跑为准（不重跑回填，counts 不变即可）。

### Step 4 — match 纯编排 + 胶水脚本 + 真实运行

4.1 `worker/sync/match.ts`：`matchAll(items: Item[], registry: Company[])` → `{ ownerRows: {itemId, companyId}[]; okIds: string[]; missingIds: string[] }`（对每条 Item 调 `ownersByMatching`，聚合 SQL 所需结构）。测试：构造 3 条 Item（0/1/2 家命中）断言聚合形态。
4.2 `scripts/match-all.ts`（npm run `match:all`）：
  - wrangler --json 读 `SELECT id, name, aliases, color, status, notes FROM companies` → 组装 Company[]（aliases 为 JSON 字符串需 parse）；
  - 读 `SELECT id, title, body_md, enrich_state FROM items`（1105 行，注意 maxBuffer）→ 组装 Item 形状（仅匹配所需字段 + id）；
  - `matchAll` → `itemCompaniesUpsertSql` + `enrichStateUpdateSql` → 临时 SQL 文件 → `wrangler d1 execute --local --file` → 删除；
  - 打印统计：ownerRows 行数、0/1/≥2 命中分布、ok / missing_owner 计数；退出码语义同 backfill（有失败非 0）。
4.3 真实运行 `npm run match:all`，**再跑一遍验证幂等**（ownerRows 行数与各计数两轮一致）。
4.4 抽样核验（--json 贴汇报）：
  - 任选一条 title 含 "Anthropic" 的 Item → item_companies 含 anthropic 行；
  - `SELECT enrich_state, COUNT(*) FROM items GROUP BY enrich_state` → ok + missing_owner 两档、总和 1105；
  - `SELECT COUNT(*) FROM item_companies WHERE role IS NOT NULL` → **必须为 0**（ADR-0014）。

## 验收清单

- [ ] `npm test` 全绿（52 + 本 spec 新增 ≥12）
- [ ] 四门禁绿
- [ ] `npm run match:all` 成功且二次幂等
- [ ] enrich_state 分布 = ok + missing_owner（总和 1105）；item_companies 全部 role NULL
- [ ] `scripts/lib/wrangler-cli.ts` 抽取后 backfill 行为不变
- [ ] 零 LLM 调用、零 Cloudflare 登录

## 边界

- 不写 enrich_cache（部署日回填任务）；不碰 read API / 前端（spec 04）；不做 scheduled 入口（spec 05）。
- `matchCompanies.ts` 只允许测试暴露缺陷后的最小修复。

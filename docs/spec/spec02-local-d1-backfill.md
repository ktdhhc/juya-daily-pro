# Spec 02 · 本地 D1 建表 + 全量回填（工程性，线性执行）

> 上游依据：`docs/plans/mvp-build-phases.md` 阶段 2；ADR-0013（D1 单存储、sources 表、零登录）、ADR-0002（Item schema）、ADR-0008（半成功入库）、ADR-0001（companies 镜像）。
> 本文可按顺序逐步执行。**全程零 Cloudflare 登录**（本地模拟 D1）。

## 目标

本地模拟 D1 建成六张表；`data/companies.yaml` 编译为类型化 registry；`npm run backfill` 一次性把 daily.juya.uk 全部历史期抓回、解析、入库（sources + items + companies）。**不写 item_companies（spec 03）**。

## 前置事实（已核验）

- `data/companies.yaml` 已入库（30 家种子，`companies:` 顶层键 + `- id:` 列表）；`data/companies-registry-todo.md` 为维护待办。
- `worker/sync/schema.sql` 现有五表（items / companies / item_companies / enrich_cache / sync_log），**缺 sources**。
- `wrangler.jsonc`：database_name `juya-daily`，binding `DB`，database_id 为占位符（本地模拟不需要真实 id）；`triggers.crons` 仍为 `["0,30 0,1,2 * * *"]`，与 ADR-0013"v1 留空"矛盾，本 spec 对齐。`main: worker/sync/index.ts` 指向尚不存在的文件——`d1 execute` 不依赖 main，本 spec 不创建。
- Node v22.20.0；Node 22 自带 fetch。`.wrangler/` 已 gitignore。`worker/`、`scripts/` 在 tsconfig include 内（typecheck 覆盖），eslint 忽略 `worker/`。
- 真实日报结构、`parseIssue`（`worker/sync/parse.ts`）已由 spec 01 交付并有 16 测试。

## 技术路线（决策记录）

回填不走 miniflare 编程 API、不直写 wrangler 内部 sqlite 文件，而是：**纯函数生成 SQL → `wrangler d1 execute juya-daily --local --file <file>` 执行**。理由：①不耦合 wrangler 内部存储布局；②SQL 生成是纯函数、可 TDD（ADR-0011）；③与 ADR 幂等要求（ON CONFLICT DO UPDATE）天然对齐。临时 SQL 文件写 `.wrangler/tmp-backfill-<ts>.sql`（gitignored），执行后删除。

## 执行步骤（线性）

### Step 1 — wrangler 依赖 + schema 增补 + 本地建表

1.1 devDeps 安装 `wrangler`（记录版本）。
1.2 `worker/sync/schema.sql` 追加 sources 表（放在 items 表之后）：

```sql
-- ─── sources（原文归档，替代 R2——ADR-0013）────────
CREATE TABLE IF NOT EXISTS sources (
  date     TEXT PRIMARY KEY,          -- YYYY-MM-DD
  markdown TEXT NOT NULL              -- 当期原文 markdown
);
```

1.3 `wrangler.jsonc`：`"crons": []`（留空对齐 ADR-0013），原表达式以注释保留：`// 部署日启用（ADR-0013）：["0,30 0,1,2 * * *"]`。
1.4 本地建表：`npx wrangler d1 execute juya-daily --local --file worker/sync/schema.sql`。
1.5 验证：`npx wrangler d1 execute juya-daily --local --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"` 输出六表（companies / enrich_cache / item_companies / items / sources / sync_log）。

### Step 2 — 纯函数 TDD：archive 解析 + SQL 生成

2.1 `worker/sync/archive.ts`：`parseArchiveDates(html: string): string[]`——从 archive 页 HTML 提取全部 `YYYY-MM-DD`，去重、**倒序**（最新在前）。测试：真实 archive 页样本（curl 一份存 `worker/sync/fixtures/archive-sample.html`）断言条数 > 50 且首条 ≥ 2026-08-27；inline 边界（去重、无日期 → []）。

2.2 `worker/sync/sqlgen.ts`（全部纯函数）：
- `escapeSqlText(s: string): string`——单引号翻倍，去除 `\0`；
- `sourcesUpsertSql(date: string, markdown: string): string`；
- `itemsUpsertSql(items: Item[]): string`——列 `id, date, tag, sequence_int, category, title, primary_link, summary, body_md, related_links, enrich_state`；`primary_link` undefined → NULL；`related_links` 存 JSON 字符串；`INSERT INTO ... VALUES ... ON CONFLICT(id) DO UPDATE SET` 全部非键列；
- `companiesUpsertSql(companies: Company[]): string`——列 `id, name, aliases(JSON), color, status, notes`，`ON CONFLICT(id) DO UPDATE`；
- 空数组 → 返回空串。
测试：单引号/换行转义 round-trip；NULL primary_link；JSON 序列化形态；ON CONFLICT 子句存在；空输入。**每条生成的语句以 `;` 收尾、单语句单行内嵌换行只出现在字符串字面量内**（wrangler 的 SQL 拆分是引号感知的，但保持该纪律降低风险）。

2.3 验证：`npm test` 全绿（新增 archive/sqlgen 测试）；四门禁绿。

### Step 3 — registry 编译 + backfill 脚本 + 真实回填

3.1 devDeps 安装 `yaml` 与 `tsx`（记录版本）。
3.2 `scripts/gen-registry.ts`：读 `data/companies.yaml` → 校验（id 为 slug 格式、name/aliases 非空、color 为 hex、status ∈ active|dormant|retired；校验失败列出问题行并退出非 0）→ 生成 `worker/registry.generated.ts`（`import type { Company } from "../src/lib/schema"` + `export const REGISTRY: Company[]`）。package.json 加 `"gen:registry": "tsx scripts/gen-registry.ts"`，执行并入库生成物。
3.3 `worker/registry.test.ts`：断言 REGISTRY ≥ 25 条、字段形状与枚举合法（防 codegen 回归）。
3.4 `scripts/backfill.ts`（I/O 胶水，纯逻辑已在 Step 2 测过）：
  - fetch archive（`https://daily.juya.uk/archive/`）→ `parseArchiveDates`；
  - 并发 3、单期失败重试 1 次仍失败则记录并继续（打印失败清单，不中断）；
  - 每期 `fetch ${MD_BASE}/<date>.md` → `parseIssue` → 累计 SQL（companiesUpsertSql(REGISTRY) + 每期 sourcesUpsertSql + itemsUpsertSql）；
  - 写 `.wrangler/tmp-backfill-<ts>.sql` → `npx wrangler d1 execute juya-daily --local --file` 执行 → 删除临时文件；若整文件执行失败，降级为逐期分块执行（打印成功/失败分块）；
  - 结束打印：archive 期数 / 成功抓取期数 / 失败清单 / sources 行数 / items 行数 / companies 行数（经 `wrangler d1 execute --local --command "select count(*) ..." --json` 查询）。
  package.json 加 `"backfill": "tsx scripts/backfill.ts"`。
3.5 **真实回填**：`npm run backfill`（约 70+ 期，几分钟内完成）。
3.6 幂等验证：**再跑一次** `npm run backfill`，两个 count 必须与首次完全一致。
3.7 抽样核验：`SELECT title, category, sequence_int FROM items WHERE id='20260827-1'` → GLM-5.3-Flash / 要闻 / 1；`SELECT COUNT(*) FROM companies` → 30；`SELECT COUNT(*) FROM sources` == archive 期数。

## 验收清单

- [ ] 本地 D1 六表齐备（sqlite_master 查询输出）
- [ ] `npm test` 全绿（spec01 16 + spec02 新增 ≥8）
- [ ] `npm test` / `npm run typecheck` / `npm run lint` / `npm run build` 四门禁绿
- [ ] `npm run backfill` 成功且幂等（两轮 count 一致）
- [ ] 抽样核验通过（20260827-1 字段正确、companies=30、sources=archive 期数）
- [ ] `wrangler.jsonc` crons 为空数组且注释保留原表达式
- [ ] 零 Cloudflare 登录（未出现任何 `--remote` 或 wrangler login）

## 边界

- 不写 item_companies / enrich_cache（spec 03）；不建 read API（spec 04）；不做 scheduled 入口（spec 05）。
- 不改 `src/`、`worker/sync/parse.ts`、`worker/sync/parse.test.ts`。
- `main: worker/sync/index.ts` 悬空维持原状（spec 04/05 落地），本 spec 不创建该文件。
- `.dev.vars`、LLM 相关一律不碰。

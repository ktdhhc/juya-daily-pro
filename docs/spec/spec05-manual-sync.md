# Spec 05 · `npm run sync` 手动增量同步（工程性，线性执行）

> 上游依据：`docs/plans/mvp-build-phases.md` 阶段 5；ADR-0008（单期容错 + sync_log）、ADR-0013（v1 手动同步、scheduled 仅挂载不启用）、ADR-0014（单段匹配）。
> 本文可按顺序逐步执行。全程零登录、零 LLM。

## 目标

增量同步能力：`npm run sync` 查本地 `max(items.date)` + `SYNC_LOOKBACK_DAYS` 决定窗口 → 抓新期 → parse → match → 写 sources/items/item_companies/enrich_state + sync_log。幂等可重跑；单期失败写 sync_log 不阻塞后续期。Worker `scheduled` 入口留挂载（v1 不生效）。

## 前置事实（已核验）

- 复用件齐备：`worker/sync/archive.ts`（parseArchiveDates）、`parse.ts`（parseIssue）、`match.ts`（matchAll）、`sqlgen.ts`（sources/items/item_companies/enrichState SQL）、`scripts/lib/wrangler-cli.ts`。
- `wrangler.jsonc` vars 已有 `SYNC_LOOKBACK_DAYS=3`（脚本从 wrangler.jsonc 读 vars 的模式照抄 `scripts/backfill.ts` 的 `varFromWranglerConfig`——建议顺手把它也挪进 `scripts/lib/wrangler-cli.ts` 共享）。
- `worker/sync/index.ts` 已存在（spec04 的 fetch 入口）。D1 现状：items max(date)=2026-08-28，archive 最新 2026-08-28（72 期）。
- sync_log 表已建：`date PK / attempted_at / status / error_message`（ADR-0008）。

## 执行步骤（线性）

### Step 1 — 纯函数：窗口选择 + sync_log SQL（先红后绿）

1.1 `worker/sync/pipeline.ts`：`selectSyncDates(archiveDates: string[], maxItemDate: string | null, lookbackDays: number): string[]`——返回需要拉取的日期（archive ∩ [maxItemDate − lookbackDays, +∞)，升序执行序）；`maxItemDate` 为 null（空库）→ 全部 archive 日期。日期算术用字符串/Date 均可，**必须**有跨月/跨年边界用例（如 max=2026-03-01、lookback=3 → 含 2026-02-26）。
1.2 `worker/sync/sqlgen.ts` 追加：`syncLogUpsertSql(date: string, status: string, errorMessage: string): string`——`INSERT INTO sync_log (date, attempted_at, status, error_message) VALUES (..., datetime('now'), ...) ON CONFLICT(date) DO UPDATE SET attempted_at=..., status=..., error_message=...`；error_message 可为 NULL（ok 时）。测试并入 sqlgen.test.ts（纪律断言 + NULL 形态 + 冲突更新子句）。

### Step 2 — Worker scheduled 挂载（stub）

`worker/sync/index.ts` 的 default export 增加 `async scheduled(controller, env, ctx)`：体内 `throw new Error("scheduled sync 尚未接线：v1 本地走 npm run sync；部署日启用（ADR-0013）")`。**不在本 spec 实现 binding 版流水线**（部署日联调时接线并可测 `--remote`）。`triggers.crons` 维持 `[]`。

### Step 3 — `scripts/sync.ts` + 真实运行

3.1 `scripts/sync.ts`（`npm run sync`，支持透传参数 `-- --dates=a,b` 强制指定期次，用于补拉与 404 演练）：
  - 读 vars：ARCHIVE_URL / MD_BASE / SYNC_LOOKBACK_DAYS（共享 varFromWranglerConfig）；
  - 查 `SELECT MAX(date) AS m FROM items` → `parseArchiveDates(await fetch archive)` → `selectSyncDates(...)`（或 `--dates` 覆盖）；
  - 并发 3、单期重试 1 次：fetch md → parseIssue →（读 D1 companies →）matchAll → SQL 累积：sourcesUpsertSql + itemsUpsertSql + itemCompaniesUpsertSql + enrichStateUpdateSql + 每期 syncLogUpsertSql(该期, 'ok', "")；
  - **失败期**：fetch/parse 抛错 → 不入数据 SQL，改写 `syncLogUpsertSql(期, 'fetch_failed'|'parse_failed', 错误消息)`，继续下一期；结束有失败 → 退出码 1；
  - 写临时 SQL → `wrangler d1 execute juya-daily --local --file` → 删除 → counts + sync_log 尾部打印。
3.2 真实运行：`npm run sync`（窗口应为 [2026-08-25..2026-08-28] 或含当日新期）→ 记录 counts。
3.3 幂等：**再跑一次**，counts 与 sync_log 状态两轮一致。
3.4 404 演练（ADR-0008 验收）：`npm run sync -- --dates=2099-01-01` → sync_log 出现 `fetch_failed` 行、退出码 1；随后正常 `npm run sync` 仍成功且后续期不受阻塞。
3.5 查询核验（--json 贴汇报）：`SELECT date, status, substr(error_message,1,40) FROM sync_log ORDER BY attempted_at DESC LIMIT 6`；`SELECT COUNT(*) FROM items`（无新期时应仍 1105）。

## 验收清单

- [ ] `npm test` 全绿（104 + 新增 ≥6：selectSyncDates 跨月/跨年/空库 + syncLog SQL）
- [ ] 四门禁绿
- [ ] `npm run sync` 成功且二次幂等
- [ ] `--dates=2099-01-01` → sync_log fetch_failed + 退出码 1，随后正常 sync 不受阻
- [ ] `worker/sync/index.ts` 有 scheduled stub 且 fetch 入口不回归（wrangler dev 仍可起）
- [ ] 零登录、零 LLM

## 边界

- 不做 retry queue / 告警（ADR-0008 MVP 取舍）；不做 binding 版 scheduled 流水线（部署日）；不碰 read API 与前端。

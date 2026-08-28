# 01 · 同步流水线：窗口纯函数 + sync_log SQL + scheduled stub + 真实运行

Status: ready-for-agent

## What to build

按 `docs/spec/spec05-manual-sync.md` Step 1→3 全部执行：

1. `worker/sync/pipeline.ts`：`selectSyncDates`（含跨月/跨年/空库用例，先红后绿）。
2. `worker/sync/sqlgen.ts` 追加 `syncLogUpsertSql`（datetime('now')、NULL error_message、ON CONFLICT DO UPDATE，先红后绿）。
3. `worker/sync/index.ts` 加 `scheduled` stub（throw 注明部署日接线；fetch 入口不回归——wrangler dev 仍能起并响应）。
4. `scripts/sync.ts`（`npm run sync`，支持 `-- --dates=a,b` 强制期次；varFromWranglerConfig 挪到 `scripts/lib/wrangler-cli.ts` 共享，backfill.ts 同步改 import）。
5. 真实运行 ×2 幂等 → `--dates=2099-01-01` 404 演练（sync_log fetch_failed + 退出码 1）→ 正常 sync 不受阻 → 查询核验输出贴汇报。

TDD 方式：pipeline 与 syncLog SQL 严格红→绿；脚本以真实运行输出为验收（每步 curl/wrangler 查询原文贴汇报）。

## Acceptance criteria

- [ ] `npm test` 全绿（104 + 新增 ≥6）
- [ ] 四门禁绿；wrangler dev 仍可起（scheduled stub 不破坏 fetch 入口）
- [ ] `npm run sync` 成功且二次幂等（counts 与 sync_log 状态一致）
- [ ] 404 演练：fetch_failed 行 + 退出码 1 + 后续正常 sync 成功
- [ ] 零登录、零 LLM

## Blocked by

None - can start immediately

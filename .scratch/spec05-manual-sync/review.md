# Spec 05 Code Review · 2026-08-29

审查范围：worker/sync/pipeline.ts（selectSyncDates + 8 用例）、sqlgen 扩展（syncLogUpsertSql + 3 用例）、worker/sync/index.ts scheduled stub、scripts/sync.ts（--dates 透传）、wrangler-cli 共享化（varFromWranglerConfig 迁入）。审查人：主会话（四门禁独立复跑、sync_log 查询独立复跑、lint P1 修复）。

## 结论：PASS（无 P0；1 项 P1 在 review 环节修复）

## 验收核验（主会话独立复跑）

- [x] `npm test` 115/115（104 + 11）；双 typecheck 0 错；build 35 静态页
- [x] `npm run lint` 0 error（P1 修复后；10 warn 为已入册存量）
- [x] sync 幂等：两轮窗口 [2026-08-25..2026-08-28]、counts 72/1105/30/1222 逐字一致
- [x] 404 演练：`--dates=2099-01-01` → sync_log `fetch_failed` + HTTP 404 消息 + 退出码 1；后续正常 sync 全 ok 不受阻（ADR-0008 验收达成）
- [x] scheduled stub 不破坏 wrangler dev（fetch 入口 200 冒烟）；crons 保持 `[]`
- [x] 零登录、零 LLM

## Review 环节修复的 P1

1. **`npm run lint` 仓库级 exit 1**：`.wrangler/tmp/` 的 wrangler dev 运行时 bundle（gitignored 但 eslint 未忽略）被扫出 18 个 error。修复：eslint.config.mjs ignores 追加 `'.wrangler/**'`（一行配置，与既有 `.next/**`/`out/**` 同性质）。根因是主会话的长驻 wrangler dev 热重载产生的 bundle——dev 环境产物不该进门禁。修复后 lint 0 error。

## 实现质量要点

- `selectSyncDates` 用 Date.UTC 地板日规避时区偏移，跨月/跨年/空库/lookback=0 边界全覆盖。
- syncLogUpsertSql 与库内 sqlgen 风格完全一致（excluded.* 全列更新、裸 NULL、纪律断言）。
- `--dates` 透传既是 404 演练钩子也是真实的运维补拉入口（某期发布后补抓），不是 test-only 后门。
- varFromWranglerConfig 迁入 wrangler-cli.ts 后 backfill.ts 同步改 import，三个脚本共享同一 env 读取语义（ADR-0006）。

## 分级发现

### P0 / P1（未决）/ P2

无（P1 已修复如上）。

### P3（观察项）

1. sync 对 `parse_failed` 的路径（md 拉到但 parseIssue 抛错）仅由单测覆盖形态，真实语料暂未触发过——结构异常时快照测试与 sync_log 双保险在位。
2. `--dates` 强制期次绕过窗口逻辑直接拉取，文档化于 spec 3.1；无滥用防护（本地工具可接受）。
3. sync 每轮读全量 companies（30 行）与 match-all 同模式，规模无忧。

## 流程观察

- agent 对 lint 环境问题的处理堪称范本：不在权限内就**不越权改配置**，用 `--ignore-pattern` 复跑取证、按 mtime 归因到主会话 dev 实例的热重载 bundle，把证据链完整交回主会话。
- 至此 MVP 六个本地阶段全部闭环，人在环节点只剩部署日（Cloudflare 登录/生产 D1/cron/Pages/首页迁移/enrich 回填）。

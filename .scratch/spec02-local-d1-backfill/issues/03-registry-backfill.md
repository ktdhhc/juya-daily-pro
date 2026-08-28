# 03 · registry 编译 + backfill 脚本 + 真实回填

Status: ready-for-agent

## What to build

按 `docs/spec/spec02-local-d1-backfill.md` Step 3 全部：

1. devDeps `yaml` + `tsx`；`scripts/gen-registry.ts` 生成 `worker/registry.generated.ts`（校验规则见 spec 3.2）；package.json 加 `gen:registry`；`worker/registry.test.ts` 防回归。
2. `scripts/backfill.ts`（spec 3.4 流程：archive → 并发 3 抓取 → parseIssue → SQL 累积 → `wrangler d1 execute --local --file` → 失败降级分块 → counts 打印）；package.json 加 `backfill`。
3. **真实回填**：`npm run backfill` 跑通全量（约 70+ 期），再跑一遍验证幂等（两轮 count 完全一致）。
4. 抽样核验（spec 3.7）：20260827-1 = GLM-5.3-Flash / 要闻 / 1；companies=30；sources == archive 期数。

TDD 方式：纯逻辑（gen-registry 校验、registry 形状）走 vitest 红→绿；backfill 主流程是 I/O 胶水，以真实运行结果为验收（两轮幂等 + 抽样查询输出贴进汇报）。

## Acceptance criteria

- [ ] `worker/registry.generated.ts` 入库，registry.test 全绿
- [ ] `npm run backfill` 成功且二次运行幂等（两个 count 逐字一致）
- [ ] 抽样查询输出与预期一致（贴汇报）
- [ ] `npm test` / typecheck / lint / build 四门禁绿
- [ ] 零 Cloudflare 登录（无 --remote、无 login）

## Blocked by

- 01-schema-wrangler.md（需要 wrangler 依赖与已建六表）
- 02-archive-sqlgen-tdd.md（需要 parseArchiveDates / sqlgen 纯函数）

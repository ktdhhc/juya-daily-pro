# 01 · Worker：q 搜索参数 + POST /api/sync + D1 治理应用

Status: ready-for-agent

## What to build

按 `docs/spec/spec06-feedback-fixes.md` A 线（A1→A6）逐步执行。契约以 spec「契约扩展」节为准。registry 治理已提交（yaml 39 家，`npm run gen:registry` 产物已更新）——你负责 D1 应用与统计。

关键实现提示：
- `companiesPruneSql`：两条 DELETE（companies + item_companies 按 company_id），NOT IN 字面量列表，纪律断言沿用；`scripts/sync.ts` 每次 run 末尾执行（先 prune 再返回 counts）。
- `q` 参数：LIKE 转义 `%`/`_`/`\`（参数化绑定 `%<escaped>%`），title/summary/body_md 三列 OR；接入 dates 与 items 两个构造器。
- `POST /api/sync`：守卫（env.SYNC_TOKEN 非空时校验 x-sync-token，否则 403 unauthorized）→ `selectSyncDates`（读 MAX(date) 经 binding）→ 并发抓取 parse → matchAll（companies 从 binding 读）→ SQL 累积（含 companiesPruneSql）→ `env.DB.exec(sql)` → 返回 `{ ok, dates, failures }`。Worker 原生 fetch 可用；单期容错同脚本。
- D1 治理应用（A4）：`npm run sync` → `npm run match:all` → 前后统计对比表贴汇报。

TDD 方式：PruneSql 与 q 参数构造器严格红→绿；sync 端点以 curl 实测验收（含幂等重跑 + token 守卫形态）。

## Acceptance criteria

- [ ] D1：companies=39、五个旧 id 零残留；missing_owner 前后对比（治理前 242）与新增公司条数表贴汇报
- [ ] `q` 与 facet 组合的单测绿（含转义）
- [ ] `POST /api/sync` 实测成功 + 幂等重跑；token 守卫形态验证（设 env 后 403）
- [ ] 四门禁绿
- [ ] happyoyster 判定完成（证据 + 处置）

## Blocked by

None - can start immediately

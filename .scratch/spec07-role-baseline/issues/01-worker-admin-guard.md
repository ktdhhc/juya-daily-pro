# 01 · Worker：requireAdmin 守卫统一 + GET /api/admin/ping

Status: ready-for-agent

## What to build

按 `docs/spec/spec07-role-baseline.md` Step 1（1.1→1.4）逐步执行。目标：服务端守卫从 SYNC_TOKEN 统一为 ADMIN_TOKEN，并新增口令验证探针端点。零登录、零 LLM。

### 1.1 纯函数 + TDD（必须先红后绿）

新建 `worker/api/auth.ts`：

```ts
export function requireAdmin(envToken: string | undefined, headerToken: string | null): boolean
```

语义：`envToken` 为 undefined 或空串 → true（本地开放）；非空 → 与 `headerToken` 严格相等才 true。

**TDD 解释**（你没有 skill 可调用，按此流程手工执行）：
1. 先写 `worker/api/auth.test.ts`（与既有测试同目录同风格，参考 `worker/sync/match.test.ts` 的用例组织），用例覆盖四分支：env 空→开放 / env 非空+header 正确→true / env 非空+header 错误→false / env 非空+header 缺失(null)→false。
2. `npx vitest run worker/api/auth.test.ts` 看它**失败**（模块不存在），把失败输出记下来。
3. 再实现 `requireAdmin`，重跑至全绿，把绿色输出记下来。
4. 汇报中贴红→绿两段证据。

### 1.2 routes.ts 切换守卫

`POST /api/sync` 的守卫（现 `syncRoute` 内联 SYNC_TOKEN 逻辑）改为：`requireAdmin(env.ADMIN_TOKEN, request.headers.get("x-admin-token"))`，不过时 403 `unauthorized`，消息改为「缺少或错误的管理口令（x-admin-token 请求头）」。Env 接口：`SYNC_TOKEN?: string` 删除，新增 `ADMIN_TOKEN?: string`（注释对齐现状写法）。**全仓 SYNC_TOKEN 引用清零**（`grep -rn SYNC_TOKEN` 只允许命中汇报文档与 .scratch；`docs/CURRENT_STATE.md` 与 docs/spec 内的残留不要改，主会话统一处理）。

### 1.3 探针端点

新增 `GET /api/admin/ping`：requireAdmin 同款守卫（header 同为 `x-admin-token`）；通过 → 200 `{ ok: true }`；不过 → 403 `unauthorized`。走 methodGuard（仅 GET）但**不进 withCache**（探针必须每次实测，不吃 60s 缓存）。405/错误格式沿用 routes.ts 现有模式。

### 1.4 .dev.vars 注释

`.dev.vars` 在仓库根目录（gitignored）。存在则追加一行、不存在则创建：`# ADMIN_TOKEN 留空=本地全开放；部署日用 wrangler secret put ADMIN_TOKEN`。不要写入任何真实 token 值。

## 红线

- 禁止 git commit / git add（主会话统一提交）。
- 只允许改动：`worker/api/auth.ts`（新建）、`worker/api/auth.test.ts`（新建）、`worker/api/routes.ts`、`.dev.vars`。其他文件一律不碰。
- TypeScript strict；注释风格与 routes.ts 现有中文注释一致；不新增依赖。
- 不改 wrangler.jsonc（ADMIN_TOKEN 是可选 secret，无需声明 vars；secrets.required 保持现状）。

## Acceptance criteria

- [ ] `requireAdmin` 四分支单测红→绿证据齐备
- [ ] `grep -rn SYNC_TOKEN worker/ src/ scripts/` 零命中
- [ ] wrangler dev 带 `--var ADMIN_TOKEN:test-token` 实测：ping 无头 403 / 错头 403 / 对头 200；sync 无头 403；杀净进程（taskkill //F //T）
- [ ] 无 token 实例（.dev.vars 不设）全开放回归：ping 与 sync 均可通
- [ ] `npx tsc --noEmit -p worker` 绿

## Blocked by

None - can start immediately

# Spec 07 · 角色权限基座（工程性，线性执行）

> 来源：2026-08-29 用户需求——轻量双角色：默认访客只见现有三页；管理员可查看面板数据（spec08）与执行同步。上游：ADR-0013（本地优先）、spec06 已落地的 SYNC_TOKEN 守卫。
> 本文可按顺序逐步执行。**零登录、零 LLM。**

## 目标

口令制双角色：进站默认访客；报头「管理」入口输口令 → 验证通过升级管理员（本地记住），同口令解锁受守卫的同步能力。**闸门在服务端**——口令不匹配，任何受守卫接口一律 403。无账号、无注册，共享口令的轻量闸门（防误触不防蓄意，个人工具的既定重量级）。

## 前置事实（已核验）

- `POST /api/sync` 已有守卫：`env.SYNC_TOKEN` 非空时校验 `x-sync-token`，403 `unauthorized`；`.dev.vars` 未设置该值 = 本地开放。
- 报头 icon-btn 模式（搜索/同步）与搜索条交互（fade-up、Esc）已有实现可复用。
- `src/lib/api.ts` 的 `apiFetch` 是唯一 fetch 出口——加请求头在这一处即可全站生效。
- `GET /api/stats` 属 spec08，本 spec 不建；口令验证需要一个轻量探针端点（下 Step 2）。
- 本地 `.dev.vars`（gitignored）不设 token 即全开放；`.env`（gitignored）同。

## 执行步骤（线性）

### Step 1 — 服务端守卫统一为 ADMIN_TOKEN

1.1 新建 `worker/api/auth.ts`：`requireAdmin(envToken: string | undefined, headerToken: string | null): boolean` 纯函数——`envToken` 为空 → true（本地开放）；非空 → 与 `headerToken` 严格相等。vitest 用例：空开放 / 正确 / 错误 / 缺头。
1.2 `routes.ts`：`POST /api/sync` 守卫从 SYNC_TOKEN 切到 `requireAdmin(env.ADMIN_TOKEN, header("x-admin-token"))`，403 语义不变（`unauthorized`）。**删除 SYNC_TOKEN 全部引用**（wrangler.jsonc 本就未声明它，仅 routes 与汇报文档有）。
1.3 新增 `GET /api/admin/ping`（requireAdmin 同款守卫）：`{ ok: true }` / 403——作为前端口令验证探针（spec08 起由 /api/stats 承担，探针保留用于快速校验）。
1.4 `.dev.vars`（本地手工，不入库）：加注释 `# ADMIN_TOKEN 留空=本地全开放；部署日用 wrangler secret put ADMIN_TOKEN`。

### Step 2 — 前端口令存取与角色态

2.1 新建 `src/lib/auth.ts`：`getAdminToken()` / `setAdminToken(t)` / `clearAdminToken()` / `isAdmin()`（localStorage key `juya-admin-token`，非空即视为管理员）。
2.2 `apiFetch`：本地存在口令时自动附 `x-admin-token` 头（全站生效，无需按端点区分）。
2.3 报头右侧新增「管理」文字链（默认态，低调字号；管理员态显示「退出管理」）：
  - 点击管理 → 展开口令输入条（复用搜索条交互：fade-up、Esc 收起；`type="password"` + 确认按钮）；
  - 确认 → `GET /api/admin/ping`（带头）探针验证：200 → `setAdminToken` 存储并升级管理员态；403 → 条内提示「口令不匹配」不清空已输入；
  - 退出管理 → `clearAdminToken()` 回访客态。
2.4 同步 icon-btn 改为**仅管理员态渲染**（访客完全不出现，而非隐藏置灰）；403 提示文案同步改「需要管理口令」。

### Step 3 — 验证

- `wrangler dev --port 8788 --var ADMIN_TOKEN:test-token` 起临时实例：无头 403 / 错头 403 / 对头 200（ping 与 sync 双端点）；杀净进程。
- 无 token 本地实例（8787 常驻）：全开放回归。
- 前端三态走查：访客（无同步按钮、点管理输错口令提示、输对升级且同步按钮出现、退出回访客）。
- 四门禁绿；`npm run build` 44 静态页不变。

## 验收清单

- [ ] requireAdmin 单测 + 探针/sync 双端点 403/200 实测
- [ ] 前端访客/管理员/口令错误三态齐备；口令存取走 src/lib/auth.ts 单点
- [ ] apiFetch 自动附头；同步按钮访客不渲染
- [ ] SYNC_TOKEN 引用清零（grep 证据）
- [ ] 四门禁绿

## 边界

- 不做导航「面板」项（spec08 随页面一起加）；不做 /api/stats；不做账号/会话/多用户。
- 口令在前端可见属既定取舍（共享口令闸门），部署日 ADMIN_TOKEN 走 secret。

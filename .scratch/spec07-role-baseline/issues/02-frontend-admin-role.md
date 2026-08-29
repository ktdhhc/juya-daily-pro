# 02 · 前端：口令存取 + 报头「管理」入口 + 同步按钮管理员态

Status: ready-for-agent

## What to build

按 `docs/spec/spec07-role-baseline.md` Step 2（2.1→2.4）逐步执行。零登录、零 LLM。服务端契约（并行 agent 正在实现，按契约开发即可，勿改 worker/ 下任何文件）：
- `GET /api/admin/ping`：带头 `x-admin-token` 通过 → 200 `{ ok: true }`；口令不符 → 403 `{ error: { code: "unauthorized", message } }`。
- `POST /api/sync` 守卫同一请求头；403 语义不变。

### 2.1 口令存取纯函数 + TDD（必须先红后绿）

新建 `src/lib/auth.ts`：

```ts
const ADMIN_TOKEN_KEY = "juya-admin-token";
export function getAdminToken(store?: Pick<Storage, "getItem" | "setItem" | "removeItem">): string;
export function setAdminToken(t: string, store?: ...): void;
export function clearAdminToken(store?: ...): void;
export function isAdmin(store?: ...): boolean; // getAdminToken() 非空即 true
```

store 参数缺省时用 `globalThis.localStorage`（SSR 下调用方保证仅在 client 事件回调里用）。**TDD 解释**（你没有 skill 可调用，按此流程手工执行）：
1. 先写 `src/lib/auth.test.ts`：用 `Map<string,string>` 造 fake store，覆盖 存→取一致 / 清空后取空串 / 空串视为非管理员 / 非空视为管理员。
2. `npx vitest run src/lib/auth.test.ts` 看失败（模块不存在），记录；实现至全绿，记录。汇报贴红→绿证据。

### 2.2 apiFetch 自动附头

`src/lib/api.ts` 的 `request()` 内：每次 fetch 前 `getAdminToken()` 非空 → headers 加 `"x-admin-token": <token>`（GET 与 POST 全站生效）。`triggerSync()` 的 403 注释文案同步更新。

### 2.3 报头「管理」入口（Header.tsx）

右侧 icon-btn 区（搜索按钮左边）新增**文字链**「管理」：

- 样式：`text-link` 或同级别低调文字（字号 text-xs，`color: var(--fg-muted)`），不用 icon、不做胶囊。管理员态显示「退出管理」。
- 点击「管理」→ 报头下方展开口令输入条（**复用搜索条交互**：`fade-up` 容器、`control-input` 样式、Esc 收起；`type="password"` +「确认」按钮，Enter 亦可提交）。
- 确认 → `fetch("/api/admin/ping", { headers: { "x-admin-token": 输入值 } })`（此处不走 apiFetch，避免读到旧 token；response 200 → `setAdminToken(输入值)` 并收起输入条；403 → 输入条内一行提示「口令不匹配」，**不清空已输入**，可重输）。
- 点击「退出管理」→ `clearAdminToken()`，回访客态。
- 角色态用 `useState` 初始化自 `isAdmin()`（组件挂载后读一次即可，不必监听 storage 事件）。

### 2.4 同步按钮管理员限定

Header.tsx 现有同步 icon-btn：**仅管理员态渲染**（条件渲染，访客 DOM 里完全不出现）；403 提示文案从「需要同步令牌」改为「需要管理口令」。搜索、日历、复制、官网、主题切换等其余控件不动。

## 红线

- 禁止 git commit / git add（主会话统一提交）。
- 只允许改动：`src/lib/auth.ts`（新建）、`src/lib/auth.test.ts`（新建）、`src/lib/api.ts`、`src/components/Header.tsx`。其他文件一律不碰（含 worker/、wrangler.jsonc、其他组件）。
- 不新增依赖；不动 globals.css（复用既有 class）；TS strict；注释中文、对齐现有风格。
- 口令输入条交互不得破坏搜索条（两者互斥展开可以，但不强制）。

## Acceptance criteria

- [ ] `src/lib/auth.test.ts` 红→绿证据
- [ ] `npx tsc --noEmit` 与 `npx eslint src/lib/auth.ts src/lib/api.ts src/components/Header.tsx` 绿
- [ ] `npm run build` 通过（44 静态页不变——本票不加页面）
- [ ] 自述：访客态 / 口令错误 / 升级管理员 / 退出管理 四态的交互路径说明（主会话将浏览器实测复核）

## Blocked by

None - can start immediately（服务端由并行 agent 同步开发，联调由主会话验收）

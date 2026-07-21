# 本地开发与部署拓扑：Next dev + wrangler dev 双进程，生产 Pages + 独立 Worker

## Context

项目同时存在 Next.js 静态导出前端与 Cloudflare Worker 后端，本地开发如何同时跑两个进程，生产如何部署，需要明确边界避免 CORS 与部署单元混乱。

## Decision

**本地开发（A + rewrites 代理）**

- 前端：`npm run dev` 跑在 `:3000`
- 后端：`wrangler dev` 跑在 `:8787`，连远程 D1/R2（`--remote`），LLM via `.dev.vars`
- 前端 `next.config.ts` rewrites 把 `/api/*` 代理到 `:8787`，前端代码用相对路径 `fetch("/api/...")`，CORS 在 dev 不出现
- 单终端看前端、单终端看 Worker，两个进程独立 HMR

**生产部署**

- 前端 → Cloudflare Pages（`out/` 静态导出）
- 后端 → 独立 Worker（cron sync + read API），D1 / R2 绑定
- 两个部署单元，前端通过同域 `/api/*` 访问 Worker（Pages Functions 代理或 Worker custom domain 共享）

## Why not the alternatives

- Pages + Functions 单体部署：前端改样式要重新 build 才能看，迭代慢
- Node mock Worker 本地层：mock 数据要维护、行为可能与真实 Worker 不一致
- 前端直 fetch Worker 跨域：CORS 配置成本、credentials 复杂、与"未来多用户查阅"的安全策略冲突

## Consequences

- 前端代码统一用相对 `/api/...`，dev 走 Next rewrites、生产走 Pages Functions 代理
- `NEXT_PUBLIC_WORKER_ORIGIN` 环境变量允许本地切换 Worker 实例（默认 `:8787`）
- 静态导出阶段 rewrites 不生效（Next `output: export` 下 rewrites 仅 dev 有用）；生产代理方式二期再定（最简方案是在 Pages Functions 写一个 `/_worker.ts` 把 `/api/*` fetch 到独立 Worker）
- 两个部署单元需要 deselect 同步：白名单 yaml 改动要 redeploy Worker 才能让运行时看到（sync:registry 脚本会跑在 Worker 启动或 cron 触发时）
- 双终端对开发者体验略有压力，但都是标准 Cloudflare/Next 工作流
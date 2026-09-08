# 05: Pages 同域 /api 代理

**What to build:** 用 Pages Function 把 `/api/*` 同域转发到 Worker（origin 由 Pages 项目变量注入），静态资源不进函数。用户视角：前端部署到 Pages 后页面直接能调后端，无需跨域配置；代理配置缺失时看到明确错误而不是白屏。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] 路径前缀校验纯函数 TDD 红→绿（仅放行 /api/ 前缀）
- [x] 本地 `pages dev` 三条 curl：`/api/*` 与 Worker 直连同形、静态路径直出（不经函数）、POST 透传
- [x] origin 缺失时返回统一错误格式的 502
- [x] 仅 `/api/*` 进函数（路由清单生效）；不新增依赖

## Comments

2026-09-08 交付 + 主会话独立验收：`isApiPath` 6 例红→绿；pages dev 代理 vs 直连解码后字节一致（2415B）、静态 `/` 与 out/index.html 字节一致、POST /api/sync 透传 200；origin 缺失 502 统一格式。审查 P2：两处裸 catch 吞异常已修（console.error + 原因入 message）。

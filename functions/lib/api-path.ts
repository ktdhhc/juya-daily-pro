// Pages 同域代理的路径前缀校验（spec15 缝 3 纯函数）。
// 语义与 Cloudflare 路由规则 /api/* 对齐：裸 /api 与 /api/... 命中，其余一律拒绝。
// 存在意义：即便 _routes.json 的 include 被误放宽，函数也只代理 /api 命名空间，
// 且目标主机恒取自 env.WORKER_ORIGIN——请求路径永远无法改写目标主机（防 SSRF）。
export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

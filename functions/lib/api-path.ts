// Pages 同域代理的路径前缀校验（spec15 缝 3 纯函数）。
// 放行 /api 与 /api/...，其余一律拒绝。注意：`_routes.json` 的 include 只写了 /api/*，
// 因此裸 /api 正常不会进入函数；本函数仍放行它，是防御纵深——即便 include 被误放宽，
// 函数也只代理 /api 命名空间，且目标主机恒取自 env.WORKER_ORIGIN，
// 请求路径永远无法改写目标主机（防 SSRF）。
export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

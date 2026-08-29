// 服务端口令闸门纯函数（spec07 Step 1.1）：POST /api/sync 与 GET /api/admin/ping 共用的守卫核心。
// 语义：envToken 未设置或空串 → 本地全开放（true）；非空 → 与 headerToken 严格相等才放行。
// 按 ADR-0011 惯例：纯函数进 vitest，I/O 层（routes.ts）以 wrangler dev + curl 验收。
export function requireAdmin(envToken: string | undefined, headerToken: string | null): boolean {
  if (envToken === undefined || envToken === "") return true;
  return headerToken === envToken;
}

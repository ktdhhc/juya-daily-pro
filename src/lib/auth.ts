// 管理口令本地存取（spec07 Step 2.1）：零登录，localStorage key juya-admin-token，非空即视为管理员。
// node 测试环境无 localStorage，函数签名接受注入 store；缺省走 globalThis.localStorage
//（SSR 下调用方保证仅在 client 事件回调里使用）。

export type TokenStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const ADMIN_TOKEN_KEY = "juya-admin-token";

export function getAdminToken(store?: TokenStore): string {
  return (store ?? globalThis.localStorage).getItem(ADMIN_TOKEN_KEY) ?? "";
}

export function setAdminToken(token: string, store?: TokenStore): void {
  (store ?? globalThis.localStorage).setItem(ADMIN_TOKEN_KEY, token);
}

export function clearAdminToken(store?: TokenStore): void {
  (store ?? globalThis.localStorage).removeItem(ADMIN_TOKEN_KEY);
}

export function isAdmin(store?: TokenStore): boolean {
  return getAdminToken(store) !== "";
}

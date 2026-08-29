// Read API 前端契约（数据形状以 docs/spec/spec04-api-views.md「API 契约」节为准，钉死）。
// Worker 由并行 agent 按同一契约开发；本文件只做 fetch 与类型，不做 mock。
// 错误格式统一为 { error: { code, message } }。

import { getAdminToken } from "./auth";

export interface ItemOwner {
  /** Company Registry id（slug），owners 按 company id 排序；无 role（ADR-0014） */
  company: string;
  name: string;
  color: string;
}

export interface StreamItem {
  id: string; // YYYYMMDD-N
  date: string; // YYYY-MM-DD
  tag: string; // #N
  sequenceInt: number; // #N 整数，解析缺失则 0
  category: string;
  title: string;
  primaryLink: string | null;
  summary: string;
  relatedLinks: string[];
  enrichState: "ok" | "missing_owner" | "pending";
  owners: ItemOwner[];
}

export interface ItemsPage {
  items: StreamItem[];
  /** 本页最早期日；本页期数 < limit → null（到底） */
  nextBeforeDate: string | null;
}

export type CompanyStatus = "active" | "dormant" | "retired";

export interface CompanyStats {
  total: number;
  last30d: number;
  lastEventDate: string | null;
}

/** GET /api/companies 条目（按 total 倒序返回） */
export interface CompanyIndexEntry {
  id: string;
  name: string;
  color: string;
  notes: string;
  aliases: string[];
  status: CompanyStatus;
  stats: CompanyStats;
}

/** GET /api/companies/:id（档案头五块，ADR-0007） */
export interface CompanyProfileResponse {
  company: {
    id: string;
    name: string;
    color: string;
    notes: string;
    aliases: string[];
    status: CompanyStatus;
  };
  stats: CompanyStats & {
    categoryDistribution: Record<string, number>;
    coworkers: { companyId: string; name: string; color: string; count: number }[]; // ≤8 按次数倒序
    timeSpan: { earliest: string; latest: string };
  };
}

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

function extractError(res: Response): ApiError {
  const fallback = `请求失败（HTTP ${res.status}）`;
  return new ApiError("unknown", res.status, fallback);
}

/** 统一 fetch：相对路径 /api/...，非 2xx 解析 { error: { code, message } } 后抛 ApiError */
export async function apiFetch<T>(path: string): Promise<T> {
  return request<T>(path);
}

/** 拼接 /api/items 过滤参数（from/to 闭区间；before_date 分页参数由调用方单独给，不进 URL——ADR-0012）。
 *  query 为报头搜索词：URL 上用 ?query=（ADR-0012 可分享），API 侧映射为 q（spec06 契约扩展 1） */
export function itemsQueryString(params: {
  company?: string;
  category?: string;
  query?: string;
  from?: string;
  to?: string;
  beforeDate?: string | null;
  limit?: number;
}): string {
  const p = new URLSearchParams();
  if (params.company) p.set("company", params.company);
  if (params.category) p.set("category", params.category);
  if (params.query) p.set("q", params.query);
  if (params.from) p.set("from", params.from);
  if (params.to) p.set("to", params.to);
  if (params.beforeDate) p.set("before_date", params.beforeDate);
  p.set("limit", String(params.limit ?? 7));
  return p.toString();
}

/** POST /api/sync 响应（spec06 契约扩展 2 + spec10 同步段契约，钉死） */
export interface SyncResponse {
  ok: boolean;
  /** 成功同步的期日期 */
  dates: string[];
  /** 本次写入暂存区的成功期（published=0，待审核；publish 前访客不可见），与 dates 同序同值 */
  stagedDates: string[];
  /** 失败期：{ date, error }，单期容错不阻塞后续期 */
  failures: { date: string; error: string }[];
}

/** POST /api/sync：增量同步（spec06 B4）。ADMIN_TOKEN 守卫生效时 403 = unauthorized（需要管理口令） */
export function triggerSync(): Promise<SyncResponse> {
  return request<SyncResponse>("/api/sync", { method: "POST" });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    // 管理口令自动附头（spec07 Step 2.2）：本地存有口令即全站请求带 x-admin-token，GET/POST 一律生效；
    // headers 在 init 之后展开，保证任何调用方都无法把该头挤掉
    const token = getAdminToken();
    res = await fetch(path, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(token ? { "x-admin-token": token } : {}),
      },
    });
  } catch {
    throw new ApiError("network", 0, "网络不可达，请检查连接后重试");
  }
  if (!res.ok) {
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      if (body?.error?.code) {
        throw new ApiError(body.error.code, res.status, body.error.message || `请求失败（HTTP ${res.status}）`);
      }
    } catch (e) {
      if (e instanceof ApiError) throw e;
    }
    throw extractError(res);
  }
  return (await res.json()) as T;
}

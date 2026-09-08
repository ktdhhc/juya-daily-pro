// 「最近一次我看到的解析终态」本机缓存（spec13 契约 C 降级语义，spec14 从 ParsePanel 抽出复用）：
// localStorage["juya-last-parse"]：解析作业状态化后，运行态一律以服务端 parse 字段为准；
// 此缓存只存终态快照（done/failed），仅在服务端报 idle / 未交付 parse 字段时兜底展示
// （spec14：兜底展示位置 = 今日流水线卡②行）。

import { ParseStatePayload } from "@/lib/api";

export interface LastParseRecord {
  at: string; // 本地 "MM-DD HH:mm"（写入时格式化，不做时区换算）
  status: "done" | "failed"; // 缓存只存终态
  processed: number;
  total: number;
  remaining: number;
  errors: string[];
}

const STORAGE_KEY = "juya-last-parse";

function fmtLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 挂载时读缓存（静态导出首帧无 window，只在 effect 里调）。兼容 spec12 旧形状
 *  （无 status/total、含 candidatesFound/skipped）：按可还原字段归一为 done 快照。 */
export function loadLastParse(): LastParseRecord | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<LastParseRecord> & { processed?: number };
    return {
      at: typeof p.at === "string" ? p.at : "",
      status: p.status === "failed" ? "failed" : "done",
      processed: typeof p.processed === "number" ? p.processed : 0,
      total: typeof p.total === "number" ? p.total : (typeof p.processed === "number" ? p.processed : 0),
      remaining: typeof p.remaining === "number" ? p.remaining : 0,
      errors: Array.isArray(p.errors) ? p.errors : [],
    };
  } catch {
    return null; // 损坏 JSON / 存储不可达：视同无记录
  }
}

/** 轮询捕获终态时写缓存（spec13 契约 C：「最近一次我看到的响应」），返回记录供兜底展示 */
export function saveLastParse(state: ParseStatePayload): LastParseRecord {
  const rec: LastParseRecord = {
    at: fmtLocal(new Date()),
    status: state.status === "failed" ? "failed" : "done",
    processed: state.processed ?? 0,
    total: state.total ?? 0,
    remaining: state.remaining ?? 0,
    errors: state.errors,
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rec));
  } catch {
    // 存储不可达（隐私模式/配额）：仅影响兜底展示，不阻塞解析流程
  }
  return rec;
}

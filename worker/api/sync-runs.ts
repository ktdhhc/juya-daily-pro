// sync_runs 运行记录纯函数层（spec14 契约 A/B）。
// 表 DDL 见 scripts/migrate-staging.sql（每行 = 一次 POST /api/sync 运行的落地摘要）。
// 本文件只放纯函数（INSERT SQL 生成 / limit 解析 / 查询构造 / 载荷组装）+ 薄 IO
//（insertSyncRun / reviewSyncRuns，routes.ts 挂载）；纯函数进 vitest
//（worker/api/sync-runs.test.ts，先红后绿，ADR-0011）。
// SQL 纪律同 worker/sync/sqlgen 与 parse-state：单语句单行、`;` 结尾、escapeSqlText。
import { escapeSqlText } from "../sync/sqlgen";

// ---------- 类型 ----------

// 写库形态（syncNow 成功路径构造；JSON 字段传数组，由 SQL 生成器序列化为 JSON 字面量）
export interface SyncRunWrite {
  startedAt: string; // ISO 时刻（同步起点）
  durationMs: number; // 函数起止实测
  windowDates: string[]; // 本轮窗口期日期数组
  added: string[]; // 三分类：不在库（新增）
  updated: string[]; // 三分类：内容有变（更新）
  unchanged: string[]; // 三分类：内容相同（未变化）
  failures: { date: string; error: string }[]; // 失败期与错误消息
  stagedItems: number; // 同步后 published=0 条目总数
}

// DB 行形态（JSON 字段为字符串字面量，组装层才解析；ok 为 0/1，组装层布尔化）
export interface SyncRunRow {
  startedAt: string | null;
  durationMs: number | null;
  windowDates: string;
  added: string;
  updated: string;
  unchanged: string;
  failures: string;
  stagedItems: number | null;
  ok: number | null;
}

// API 载荷形态（spec14 契约 B：camelCase，JSON 字段解析为真数组，ok 布尔化）
export interface SyncRunPayload {
  startedAt: string | null;
  durationMs: number;
  windowDates: string[];
  added: string[];
  updated: string[];
  unchanged: string[];
  failures: { date: string; error: string }[];
  stagedItems: number;
  ok: boolean;
}

// ---------- INSERT SQL 生成（spec14 契约 A/B：syncNow 成功路径落一行） ----------

const quote = (s: string): string => `'${escapeSqlText(s)}'`;

// sync_runs 单行 INSERT：JSON 字段 JSON.stringify 后按文本字面量转义嵌入；
// ok 映射 failures.length === 0 → 1 / 否则 0。单语句单行、`;` 收尾。
export function syncRunInsertSql(w: SyncRunWrite): string {
  const ok = w.failures.length === 0 ? 1 : 0;
  return (
    "INSERT INTO sync_runs (started_at, duration_ms, window_dates, added, updated, unchanged, failures, staged_items, ok) VALUES (" +
    `${quote(w.startedAt)}, ${Number(w.durationMs) || 0}, ${quote(JSON.stringify(w.windowDates))}, ` +
    `${quote(JSON.stringify(w.added))}, ${quote(JSON.stringify(w.updated))}, ${quote(JSON.stringify(w.unchanged))}, ` +
    `${quote(JSON.stringify(w.failures))}, ${Number(w.stagedItems) || 0}, ${ok});`
  );
}

// ---------- limit 解析（spec14 契约 B：缺省 20 / 上限 100 / 非法回退 20，对齐 parseHistoryLimit） ----------

export const SYNC_RUNS_LIMIT_DEFAULT = 20;
export const SYNC_RUNS_LIMIT_MAX = 100;

export function parseSyncRunsLimit(raw: string | null): number {
  const t = raw?.trim() ?? "";
  if (!/^\d+$/.test(t)) return SYNC_RUNS_LIMIT_DEFAULT;
  const n = Number(t);
  if (n < 1) return SYNC_RUNS_LIMIT_DEFAULT;
  return Math.min(n, SYNC_RUNS_LIMIT_MAX);
}

// ---------- 查询构造器（纯函数） ----------

// sync_runs 行源：最近 limit 条按 started_at 倒序（LIMIT 走绑定参数）。
// snake_case 列一律 AS 成 SyncRunRow 的 camelCase 键——行类型对齐 history.ts 先例
//（D1 返回行键取决于 SELECT 别名而非表列名，别名缺位会让行类型成为谎言）。
export function buildSyncRunsQuery(limit: number): { sql: string; params: number[] } {
  return {
    sql:
      "SELECT started_at AS startedAt, duration_ms AS durationMs, window_dates AS windowDates, " +
      "added, updated, unchanged, failures, staged_items AS stagedItems, ok" +
      " FROM sync_runs ORDER BY started_at DESC LIMIT ?",
    params: [limit],
  };
}

// ---------- 组装纯函数 ----------

// JSON 字符串数组容错解析：损坏 / 非数组 → []；元素过滤为字符串（对齐 parse-state parseErrorsJson 先例）
function parseStringArrayJson(raw: string | null): string[] {
  if (raw === null) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

// failures JSON 容错解析：元素须为 {date, error} 形状，非法元素丢弃（损坏行返回空数组而非抛错）
function parseFailuresJson(raw: string | null): { date: string; error: string }[] {
  if (raw === null) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter(
      (x): x is { date: string; error: string } =>
        typeof x === "object" && x !== null && "date" in x && "error" in x,
    );
  } catch {
    return [];
  }
}

// 数值归一：null / 非有限数 → 0（防御性容忍异常输入，对齐 history statCount 先例）
function countValue(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : n === 0 ? 0 : 0;
}

// DB 行 → API 载荷：JSON 字段解析容错（损坏行返回空数组字段而非抛错）；
// 输出行序与输入（SQL started_at DESC 倒序）逐行一致，不重排。
export function assembleSyncRuns(rows: SyncRunRow[]): SyncRunPayload[] {
  return rows.map((r) => ({
    startedAt: r.startedAt ?? null,
    durationMs: countValue(r.durationMs),
    windowDates: parseStringArrayJson(r.windowDates),
    added: parseStringArrayJson(r.added),
    updated: parseStringArrayJson(r.updated),
    unchanged: parseStringArrayJson(r.unchanged),
    failures: parseFailuresJson(r.failures),
    stagedItems: countValue(r.stagedItems),
    ok: r.ok === 1,
  }));
}

// ---------- 薄 IO（routes.ts 挂载） ----------

// syncNow 成功路径落一行运行记录（单语句 prepare 执行）
export async function insertSyncRun(env: { DB: D1Database }, row: SyncRunWrite): Promise<void> {
  await env.DB.prepare(syncRunInsertSql(row)).run();
}

// GET /api/review/sync-runs：最近 limit 条倒序运行记录
export async function reviewSyncRuns(
  env: { DB: D1Database },
  rawLimit: string | null,
): Promise<{ runs: SyncRunPayload[] }> {
  const q = buildSyncRunsQuery(parseSyncRunsLimit(rawLimit));
  const res = await env.DB.prepare(q.sql).bind(...q.params).all<SyncRunRow>();
  return { runs: assembleSyncRuns(res.results) };
}

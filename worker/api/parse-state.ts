// parse_state 单行作业状态的纯函数层（spec13 契约 A/B/C）。
// 表 DDL 见 scripts/migrate-staging.sql（单行 id=1，同一时刻至多一轮解析）。
// 本文件只放纯函数（busy 判定 / 载荷组装 / upsert SQL 生成），D1 读写薄 IO 在
// worker/api/parse.ts（readParseState / writeParseState）；纯函数进 vitest
//（worker/api/parse.test.ts，先红后绿，ADR-0011）。
// SQL 纪律同 worker/sync/sqlgen：单语句单行、`;` 结尾、escapeSqlText、幂等 upsert。
import { escapeSqlText } from "../sync/sqlgen";

// ---------- 类型 ----------

export type ParseStateStatus = "idle" | "running" | "done" | "failed";

// DB 行形态（parse_state 单行；errors 为 JSON 字符串字面量，组装层才解析）
export interface ParseStateRow {
  id: number;
  status: ParseStateStatus;
  startedAt: string | null;
  finishedAt: string | null;
  processed: number;
  total: number;
  remaining: number;
  errors: string; // JSON string[] 字面量
}

// API 载荷形态（spec13 契约 C：idle → 余字段 null，errors 恒为字符串数组）
export interface ParseStatePayload {
  status: ParseStateStatus;
  startedAt: string | null;
  finishedAt: string | null;
  processed: number | null;
  total: number | null;
  remaining: number | null;
  errors: string[];
}

// 写库形态（upsert 全列；errors 传字符串数组，由 SQL 生成器序列化为 JSON 字面量）
export interface ParseStateWrite {
  status: ParseStateStatus;
  startedAt: string | null;
  finishedAt: string | null;
  processed: number;
  total: number;
  remaining: number;
  errors: string[];
}

// ---------- busy 判定（spec13 契约 B 启动守卫） ----------

// 陈旧阈值：running 超 10 分钟视为 worker 中断遗留，允许覆盖重跑
export const PARSE_STALE_MS = 10 * 60 * 1000;

// status='running' 且 startedAt 距 now <10 分钟 → busy；超时陈旧 / startedAt 缺失
//（无法计时，按陈旧自愈放行）/ idle·done·failed / 无记录（null）→ 不 busy。
export function parseBusy(prev: ParseStateRow | null, now: Date): boolean {
  if (prev === null || prev.status !== "running" || prev.startedAt === null) return false;
  const elapsed = now.getTime() - new Date(prev.startedAt).getTime();
  return elapsed < PARSE_STALE_MS; // 非法时间串 → NaN 比较 false → 同样放行重跑
}

// ---------- 载荷组装（spec13 契约 C） ----------

// idle 单行常量（迁移 seed 行的等价形态；表无行时 readParseState 以此归一兜底）
export function emptyParseState(): ParseStateRow {
  return {
    id: 1,
    status: "idle",
    startedAt: null,
    finishedAt: null,
    processed: 0,
    total: 0,
    remaining: 0,
    errors: "[]",
  };
}

// errors JSON 容错解析：损坏 / 非数组 → []；元素过滤为字符串
function parseErrorsJson(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

// DB 行 → API 载荷：idle 行（或无行）归一为 status:'idle' 且余字段全 null（残留计数抹平）；
// running/done/failed 计数与时间戳透传，errors JSON 解析容错。
export function assembleParseState(row: ParseStateRow | null): ParseStatePayload {
  if (row === null || row.status === "idle") {
    return {
      status: "idle",
      startedAt: null,
      finishedAt: null,
      processed: null,
      total: null,
      remaining: null,
      errors: [],
    };
  }
  return {
    status: row.status,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    processed: Number(row.processed ?? 0),
    total: Number(row.total ?? 0),
    remaining: Number(row.remaining ?? 0),
    errors: parseErrorsJson(row.errors),
  };
}

// ---------- upsert SQL 生成 ----------

const quote = (s: string): string => `'${escapeSqlText(s)}'`;

// parse_state 单行 upsert（spec13 契约 A/B）：id 恒为 1，全列写入（重放安全，幂等）。
// 时间戳 null → NULL 字面量；errors 数组 → JSON 字面量。单语句单行、`;` 结尾。
export function parseStateUpsertSql(w: ParseStateWrite): string {
  const startedAt = w.startedAt === null ? "NULL" : quote(w.startedAt);
  const finishedAt = w.finishedAt === null ? "NULL" : quote(w.finishedAt);
  return (
    "INSERT INTO parse_state (id, status, started_at, finished_at, processed, total, remaining, errors) " +
    `VALUES (1, ${quote(w.status)}, ${startedAt}, ${finishedAt}, ${w.processed}, ${w.total}, ` +
    `${w.remaining}, ${quote(JSON.stringify(w.errors))}) ` +
    "ON CONFLICT(id) DO UPDATE SET status = excluded.status, started_at = excluded.started_at, " +
    "finished_at = excluded.finished_at, processed = excluded.processed, total = excluded.total, " +
    "remaining = excluded.remaining, errors = excluded.errors;"
  );
}

// sync_runs 纯函数测试（spec14 契约 A/B，TDD 先红后绿）。
// 覆盖：syncRunInsertSql（转义 / JSON 字段序列化 / ok 映射 / 单语句单行纪律）；
// parseSyncRunsLimit（缺省 20 / 上限 100 / 非法回退 20，对齐 parseHistoryLimit 先例）；
// buildSyncRunsQuery（started_at 倒序 + LIMIT 绑定参数）；assembleSyncRuns（字段映射 /
// JSON 容错 / 倒序保持 / 空输入）。D1 读写为薄 IO，不单测（ADR-0011），以 wrangler dev + curl 验收。
import { describe, expect, it } from "vitest";
import {
  SYNC_RUNS_LIMIT_DEFAULT,
  SYNC_RUNS_LIMIT_MAX,
  assembleSyncRuns,
  buildSyncRunsQuery,
  parseSyncRunsLimit,
  syncRunInsertSql,
  type SyncRunRow,
  type SyncRunWrite,
} from "./sync-runs";

// ---------- syncRunInsertSql ----------

const BASE_WRITE: SyncRunWrite = {
  startedAt: "2026-08-30T00:00:00.000Z",
  durationMs: 123,
  windowDates: ["2026-08-30", "2026-08-29"],
  added: ["2026-08-30"],
  updated: [],
  unchanged: ["2026-08-29"],
  failures: [],
  stagedItems: 12,
};

describe("syncRunInsertSql", () => {
  it("全列 INSERT：列清单含 sync_runs 九列，JSON 字段以 JSON 字面量嵌入", () => {
    const sql = syncRunInsertSql(BASE_WRITE);
    expect(sql).toContain(
      "INSERT INTO sync_runs (started_at, duration_ms, window_dates, added, updated, unchanged, failures, staged_items, ok) VALUES (",
    );
    expect(sql).toContain("'2026-08-30T00:00:00.000Z'");
    expect(sql).toContain(", 123,");
    expect(sql).toContain("'[\"2026-08-30\",\"2026-08-29\"]'"); // window_dates JSON
    expect(sql).toContain("'[\"2026-08-30\"]'"); // added
    expect(sql).toContain("'[]'"); // updated
    expect(sql).toContain("'[\"2026-08-29\"]'"); // unchanged
    expect(sql).toContain("12, 1)"); // staged_items + ok=1（无失败）
  });

  it("ok 映射：failures 空 → 1；failures 非空 → 0", () => {
    expect(syncRunInsertSql(BASE_WRITE).endsWith(", 12, 1);")).toBe(true);
    const withFailure = syncRunInsertSql({
      ...BASE_WRITE,
      failures: [{ date: "2026-08-28", error: "HTTP 404" }],
    });
    expect(withFailure.endsWith(", 12, 0);")).toBe(true);
    expect(withFailure).toContain(
      "'[{\"date\":\"2026-08-28\",\"error\":\"HTTP 404\"}]'",
    );
  });

  it("SQL 转义：文本内单引号翻倍（escapeSqlText）", () => {
    const sql = syncRunInsertSql({
      ...BASE_WRITE,
      failures: [{ date: "2026-08-28", error: "HTTP 404 O'Brien" }],
    });
    expect(sql).toContain("'[{\"date\":\"2026-08-28\",\"error\":\"HTTP 404 O''Brien\"}]'");
  });

  it("SQL 纪律：单语句单行、`;` 收尾、无换行", () => {
    const sql = syncRunInsertSql(BASE_WRITE);
    expect(sql.includes("\n")).toBe(false);
    expect(sql.endsWith(";")).toBe(true);
  });
});

// ---------- parseSyncRunsLimit ----------

describe("parseSyncRunsLimit", () => {
  it("缺省 / 空白 → 20", () => {
    expect(parseSyncRunsLimit(null)).toBe(SYNC_RUNS_LIMIT_DEFAULT);
    expect(parseSyncRunsLimit("")).toBe(SYNC_RUNS_LIMIT_DEFAULT);
    expect(parseSyncRunsLimit("  ")).toBe(SYNC_RUNS_LIMIT_DEFAULT);
  });

  it("合法值原样；上限 100 截断", () => {
    expect(parseSyncRunsLimit("1")).toBe(1);
    expect(parseSyncRunsLimit("20")).toBe(20);
    expect(parseSyncRunsLimit("100")).toBe(SYNC_RUNS_LIMIT_MAX);
    expect(parseSyncRunsLimit("150")).toBe(SYNC_RUNS_LIMIT_MAX);
  });

  it("非法回退 20：非数字 / 小数 / 负数 / 0", () => {
    expect(parseSyncRunsLimit("abc")).toBe(SYNC_RUNS_LIMIT_DEFAULT);
    expect(parseSyncRunsLimit("20.5")).toBe(SYNC_RUNS_LIMIT_DEFAULT);
    expect(parseSyncRunsLimit("-5")).toBe(SYNC_RUNS_LIMIT_DEFAULT);
    expect(parseSyncRunsLimit("0")).toBe(SYNC_RUNS_LIMIT_DEFAULT);
  });
});

// ---------- buildSyncRunsQuery ----------

describe("buildSyncRunsQuery", () => {
  it("行源 sync_runs：started_at 倒序，LIMIT 走绑定参数；snake_case 列全部 AS 成 camelCase 行键", () => {
    const q = buildSyncRunsQuery(20);
    expect(q.sql).toContain("FROM sync_runs");
    expect(q.sql).toContain("ORDER BY started_at DESC LIMIT ?");
    expect(q.sql).toContain("window_dates AS windowDates");
    expect(q.sql).toContain("staged_items AS stagedItems");
    expect(q.sql).toContain("started_at AS startedAt");
    expect(q.params).toEqual([20]);
  });
});

// ---------- assembleSyncRuns ----------

// 输入序 = SQL started_at 倒序（两行 started_at 可相同——同日两轮同步）
const ROWS: SyncRunRow[] = [
  {
    startedAt: "2026-08-31T10:00:00.000Z",
    durationMs: 2500,
    windowDates: '["2026-08-30"]',
    added: '["2026-08-30"]',
    updated: "[]",
    unchanged: "[]",
    failures: "[]",
    stagedItems: 5,
    ok: 1,
  },
  {
    startedAt: "2026-08-30T09:00:00.000Z",
    durationMs: 1800,
    windowDates: '["2026-08-29","2026-08-28"]',
    added: "[]",
    updated: '["2026-08-29"]',
    unchanged: '["2026-08-28"]',
    failures: '[{"date":"2026-08-28","error":"HTTP 404"}]',
    stagedItems: 3,
    ok: 0,
  },
];

describe("assembleSyncRuns", () => {
  it("字段映射：JSON 字段解析、ok 布尔化、camelCase 载荷", () => {
    const runs = assembleSyncRuns(ROWS);
    expect(runs[0]).toEqual({
      startedAt: "2026-08-31T10:00:00.000Z",
      durationMs: 2500,
      windowDates: ["2026-08-30"],
      added: ["2026-08-30"],
      updated: [],
      unchanged: [],
      failures: [],
      stagedItems: 5,
      ok: true,
    });
    expect(runs[1]).toEqual({
      startedAt: "2026-08-30T09:00:00.000Z",
      durationMs: 1800,
      windowDates: ["2026-08-29", "2026-08-28"],
      added: [],
      updated: ["2026-08-29"],
      unchanged: ["2026-08-28"],
      failures: [{ date: "2026-08-28", error: "HTTP 404" }],
      stagedItems: 3,
      ok: false,
    });
  });

  it("倒序保持：输出行序与输入（SQL started_at DESC）逐行一致，不重排", () => {
    expect(assembleSyncRuns(ROWS).map((r) => r.startedAt)).toEqual([
      "2026-08-31T10:00:00.000Z",
      "2026-08-30T09:00:00.000Z",
    ]);
  });

  it("JSON 容错：损坏 JSON → 空数组字段而非抛错；failures 非法元素被过滤", () => {
    const corrupted: SyncRunRow[] = [
      {
        startedAt: "2026-08-30T09:00:00.000Z",
        durationMs: null as unknown as number,
        windowDates: "{not json",
        added: "not-an-array",
        updated: '"scalar"',
        unchanged: null as unknown as string,
        failures: '[{"no":"shape"},"junk",{"date":"2026-08-27","error":"HTTP 500"}]',
        stagedItems: "12" as unknown as number,
        ok: 0,
      },
    ];
    const runs = assembleSyncRuns(corrupted);
    expect(runs).toHaveLength(1);
    expect(runs[0].windowDates).toEqual([]);
    expect(runs[0].added).toEqual([]);
    expect(runs[0].updated).toEqual([]);
    expect(runs[0].unchanged).toEqual([]);
    expect(runs[0].failures).toEqual([{ date: "2026-08-27", error: "HTTP 500" }]);
    expect(runs[0].stagedItems).toBe(12);
    expect(runs[0].durationMs).toBe(0); // null / 非有限数值归 0
    expect(runs[0].ok).toBe(false);
  });

  it("空输入：rows 空 → runs 空", () => {
    expect(assembleSyncRuns([])).toEqual([]);
  });
});

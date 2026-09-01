// history 纯函数测试（spec12 契约 F，TDD 先红后绿）。
// 覆盖：assembleHistory 合并 / 倒序保持 / 无条目期补零 / 条目数负值与异常输入不炸；
// parseHistoryLimit（缺省 30 / 上限 100 / 非法回退 30）；buildHistoryQuery / buildHistoryStatsQuery 形状。
// D1 读写为薄 IO，不单测（ADR-0011），以 wrangler dev + curl 验收。
import { describe, expect, it } from "vitest";
import {
  HISTORY_LIMIT_DEFAULT,
  HISTORY_LIMIT_MAX,
  assembleHistory,
  buildHistoryQuery,
  buildHistoryStatsQuery,
  parseHistoryLimit,
  type HistoryStatRow,
  type HistorySyncRow,
} from "./history";

// ---------- assembleHistory ----------

// 输入序 = SQL attempted_at 倒序（允许与 date 序不同——旧期重同步的 attempted_at 更新）
const SYNC_ROWS: HistorySyncRow[] = [
  { date: "2026-08-29", status: "ok", error: null, attemptedAt: "2026-08-31 15:28:47" },
  {
    date: "2026-08-27",
    status: "fetch_failed",
    error: "HTTP 404 https://daily.juya.uk/markdown/2026-08-27.md",
    attemptedAt: "2026-08-30 10:00:00",
  },
  { date: "2026-08-30", status: "ok", error: null, attemptedAt: "2026-08-30 00:30:00" },
];
const STAT_ROWS: HistoryStatRow[] = [
  { date: "2026-08-29", items: 16, published: 0, attributed: 14 },
  { date: "2026-08-30", items: 12, published: 12, attributed: 12 },
  { date: "2026-08-26", items: 5, published: 5, attributed: 5 }, // 孤儿统计：syncRows 无此期
];

describe("assembleHistory", () => {
  it("合并：统计按 date 挂到对应行（items/published/attributed），孤儿统计被忽略", () => {
    const history = assembleHistory(SYNC_ROWS, STAT_ROWS);
    expect(history).toHaveLength(3);
    expect(history[0]).toEqual({
      date: "2026-08-29",
      status: "ok",
      error: null,
      attemptedAt: "2026-08-31 15:28:47",
      items: 16,
      published: 0,
      attributed: 14,
    });
    expect(history[2]).toEqual({
      date: "2026-08-30",
      status: "ok",
      error: null,
      attemptedAt: "2026-08-30 00:30:00",
      items: 12,
      published: 12,
      attributed: 12,
    });
    expect(history.some((h) => h.date === "2026-08-26")).toBe(false);
  });

  it("倒序保持：输出行序与输入（SQL attempted_at DESC）逐行一致，不按 date 重排", () => {
    const history = assembleHistory(SYNC_ROWS, STAT_ROWS);
    expect(history.map((h) => h.date)).toEqual(["2026-08-29", "2026-08-27", "2026-08-30"]);
  });

  it("无条目期补零：sync_log 有行而 items 无统计 → items/published/attributed 全 0", () => {
    const history = assembleHistory(SYNC_ROWS, STAT_ROWS);
    expect(history[1]).toEqual({
      date: "2026-08-27",
      status: "fetch_failed",
      error: "HTTP 404 https://daily.juya.uk/markdown/2026-08-27.md",
      attemptedAt: "2026-08-30 10:00:00",
      items: 0,
      published: 0,
      attributed: 0,
    });
  });

  it("异常输入不炸：负值归 0、字符串数字归一、null/undefined 容忍", () => {
    const syncRows: HistorySyncRow[] = [
      {
        date: "2026-08-30",
        status: "ok",
        error: undefined as unknown as null,
        attemptedAt: undefined as unknown as null,
      },
    ];
    const statRows = [
      { date: "2026-08-30", items: -3, published: "7", attributed: null } as unknown as HistoryStatRow,
    ];
    const history = assembleHistory(syncRows, statRows);
    expect(history).toEqual([
      {
        date: "2026-08-30",
        status: "ok",
        error: null,
        attemptedAt: null,
        items: 0,
        published: 7,
        attributed: 0,
      },
    ]);
  });

  it("空输入：syncRows 空 → 空历史（statRows 孤儿不产生行）", () => {
    expect(assembleHistory([], STAT_ROWS)).toEqual([]);
  });
});

// ---------- parseHistoryLimit ----------

describe("parseHistoryLimit", () => {
  it("缺省 / 空白 → 30", () => {
    expect(parseHistoryLimit(null)).toBe(HISTORY_LIMIT_DEFAULT);
    expect(parseHistoryLimit("")).toBe(HISTORY_LIMIT_DEFAULT);
    expect(parseHistoryLimit("  ")).toBe(HISTORY_LIMIT_DEFAULT);
  });

  it("合法值原样；上限 100 截断", () => {
    expect(parseHistoryLimit("50")).toBe(50);
    expect(parseHistoryLimit("100")).toBe(HISTORY_LIMIT_MAX);
    expect(parseHistoryLimit("150")).toBe(HISTORY_LIMIT_MAX);
    expect(parseHistoryLimit("1")).toBe(1);
  });

  it("非法回退 30：非数字 / 小数 / 负数 / 0", () => {
    expect(parseHistoryLimit("abc")).toBe(HISTORY_LIMIT_DEFAULT);
    expect(parseHistoryLimit("30.5")).toBe(HISTORY_LIMIT_DEFAULT);
    expect(parseHistoryLimit("-5")).toBe(HISTORY_LIMIT_DEFAULT);
    expect(parseHistoryLimit("0")).toBe(HISTORY_LIMIT_DEFAULT);
  });
});

// ---------- 查询构造器 ----------

describe("buildHistoryQuery", () => {
  it("sync_log 行源：attempted_at 倒序，LIMIT 走绑定参数", () => {
    const q = buildHistoryQuery(30);
    expect(q.sql).toContain(
      "SELECT date, status, error_message AS error, attempted_at AS attemptedAt FROM sync_log",
    );
    expect(q.sql).toContain("ORDER BY attempted_at DESC LIMIT ?");
    expect(q.params).toEqual([30]);
  });
});

describe("buildHistoryStatsQuery", () => {
  it("一条 GROUP BY：COUNT(*) / SUM(published) / enrich_state='ok' 计数，date IN 绑定参数", () => {
    const q = buildHistoryStatsQuery(["2026-08-30", "2026-08-29"]);
    expect(q.sql).toContain("COUNT(*) AS items");
    expect(q.sql).toContain("SUM(published) AS published");
    expect(q.sql).toContain("enrich_state = 'ok'");
    expect(q.sql).toContain("FROM items");
    expect(q.sql).toContain("WHERE date IN (?,?)"); // 占位符 join(",") 无空格（同 parse.ts 既有写法）
    expect(q.sql).toContain("GROUP BY date");
    expect(q.params).toEqual(["2026-08-30", "2026-08-29"]);
  });
});

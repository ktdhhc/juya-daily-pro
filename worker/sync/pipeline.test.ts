// pipeline TDD 测试（spec05 Step 1.1：selectSyncDates 同步窗口纯函数）。
// 覆盖：跨月/跨年边界（必须用例）、空库全量、窗口过滤（含地板日边界与 max 当日）、
// 升序执行序（parseArchiveDates 输出为倒序）、空输入、lookback=0。
import { describe, expect, it } from "vitest";
import { selectSyncDates } from "./pipeline";

describe("selectSyncDates", () => {
  it("跨月边界：max=2026-03-01、lookback=3 → 窗口地板 2026-02-26（含），2026-02-25（不含）", () => {
    const dates = selectSyncDates(
      ["2026-02-20", "2026-02-25", "2026-02-26", "2026-02-27", "2026-03-01"],
      "2026-03-01",
      3,
    );
    expect(dates).toEqual(["2026-02-26", "2026-02-27", "2026-03-01"]);
  });

  it("跨年边界：max=2026-01-02、lookback=3 → 窗口地板 2025-12-30（含），2025-12-29（不含）", () => {
    const dates = selectSyncDates(
      ["2025-12-29", "2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02"],
      "2026-01-02",
      3,
    );
    expect(dates).toEqual(["2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02"]);
  });

  it("空库（maxItemDate=null）→ 全部 archive 日期，升序输出", () => {
    const dates = selectSyncDates(["2026-08-28", "2025-03-01", "2026-01-02"], null, 3);
    expect(dates).toEqual(["2025-03-01", "2026-01-02", "2026-08-28"]);
  });

  it("窗口过滤：仅保留 ≥ maxItemDate−lookbackDays 的日期，max 当日含在窗口内", () => {
    const dates = selectSyncDates(
      ["2026-08-20", "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28"],
      "2026-08-28",
      3,
    );
    expect(dates).toEqual(["2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28"]);
  });

  it("升序执行序：输入为 archive 的倒序（最新在前，parseArchiveDates 形态）也输出升序", () => {
    const dates = selectSyncDates(
      ["2026-08-28", "2026-08-27", "2026-08-26", "2026-08-25"],
      "2026-08-28",
      7,
    );
    expect(dates).toEqual(["2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28"]);
  });

  it("archive 为空 → 空数组（有 max / 空库均然）", () => {
    expect(selectSyncDates([], "2026-08-28", 3)).toEqual([]);
    expect(selectSyncDates([], null, 3)).toEqual([]);
  });

  it("maxItemDate 早于全部 archive 日期 → 全部纳入（无上限过滤）", () => {
    const dates = selectSyncDates(["2026-08-27", "2026-08-28"], "2026-01-01", 3);
    expect(dates).toEqual(["2026-08-27", "2026-08-28"]);
  });

  it("lookback=0 → 仅保留 ≥ maxItemDate 的日期", () => {
    const dates = selectSyncDates(["2026-08-27", "2026-08-28"], "2026-08-28", 0);
    expect(dates).toEqual(["2026-08-28"]);
  });
});

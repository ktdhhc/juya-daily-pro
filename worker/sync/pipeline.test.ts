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

// ---------- classifyWindow（spec12 后续：同步消息诚实化） ----------

import { classifyWindow } from "./pipeline";

describe("classifyWindow（同步窗口三分类：新增/有更新/未变化）", () => {
  const fetched = [
    { date: "2026-09-01", markdown: "新版内容" },
    { date: "2026-08-31", markdown: "修订后内容" },
    { date: "2026-08-30", markdown: "一模一样" },
  ];

  it("三类各归其位：不在库=新增，在库且内容不同=有更新，在库且内容相同=未变化", () => {
    const existing = new Map([
      ["2026-08-31", "原始内容"],
      ["2026-08-30", "一模一样"],
    ]);
    expect(classifyWindow(fetched, existing)).toEqual({
      added: ["2026-09-01"],
      updated: ["2026-08-31"],
      unchanged: ["2026-08-30"],
    });
  });

  it("空库全为新增；日期序保持与抓取序一致（升序）", () => {
    expect(classifyWindow(fetched, new Map())).toEqual({
      added: ["2026-09-01", "2026-08-31", "2026-08-30"],
      updated: [],
      unchanged: [],
    });
  });

  it("抓取失败期（不在 fetched 列表）不参与分类", () => {
    expect(classifyWindow([{ date: "2026-08-30", markdown: "一模一样" }], new Map([["2026-08-30", "一模一样"]]))).toEqual({
      added: [],
      updated: [],
      unchanged: ["2026-08-30"],
    });
  });
});

// ---------- classifyWindow 补正（消息诚实化二轮：暂存期不算「未变化」） ----------

describe("classifyWindow 暂存期归入新内容（staged 集合注入）", () => {
  it("在库但处于暂存态（published=0）→ added（待审核的新内容，不算核对通过）", () => {
    const fetched = [
      { date: "2026-09-06", markdown: "内容相同" },
      { date: "2026-09-05", markdown: "内容相同" },
      { date: "2026-09-04", markdown: "内容相同" },
    ];
    const existing = new Map([
      ["2026-09-06", "内容相同"],
      ["2026-09-05", "内容相同"],
      ["2026-09-04", "内容相同"],
    ]);
    const staged = new Set(["2026-09-06", "2026-09-05", "2026-09-04"]);
    expect(classifyWindow(fetched, existing, staged)).toEqual({
      added: ["2026-09-06", "2026-09-05", "2026-09-04"],
      updated: [],
      unchanged: [],
    });
  });

  it("已入库期内容相同 → unchanged 不变", () => {
    const fetched = [{ date: "2026-09-02", markdown: "同" }];
    const existing = new Map([["2026-09-02", "同"]]);
    expect(classifyWindow(fetched, existing, new Set(["2026-09-03"]))).toEqual({
      added: [],
      updated: [],
      unchanged: ["2026-09-02"],
    });
  });

  it("staged 参数缺省 → 旧行为兼容（在库即 unchanged）", () => {
    const fetched = [{ date: "2026-09-02", markdown: "同" }];
    expect(classifyWindow(fetched, new Map([["2026-09-02", "同"]]))).toEqual({
      added: [],
      updated: [],
      unchanged: ["2026-09-02"],
    });
  });
});

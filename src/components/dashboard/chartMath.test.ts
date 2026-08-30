// 数据面板纯计算辅助单测（spec08 Step 3.1，TDD 先行）。
// 覆盖：parseLocalDate（本地时区解析）、relativeTime（UTC 挂钟→相对时间）、heatmapLevel（4 档分档）、
// buildHeatmapCells（12 周网格对齐/ok 优先/网格外忽略/tip 文案）、lineGeometry（稀疏坐标换算）、
// donutSegments（三段占比/偏移/中角）、pct / shortDate（展示文案）。
// 约定：日期一律 "YYYY-MM-DD" 字符串；lastSyncAt 为 UTC naive "YYYY-MM-DD HH:MM:SS"。
import { describe, expect, it } from "vitest";
import {
  buildHeatmapCells,
  donutSegments,
  heatmapLevel,
  lineGeometry,
  parseLocalDate,
  pct,
  relativeTime,
  shortDate,
} from "./chartMath";

describe("parseLocalDate", () => {
  it("纯日期按本地零点解析（拒绝 new Date(str) 的 UTC 语义）", () => {
    const d = parseLocalDate("2026-08-29");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(7);
    expect(d!.getDate()).toBe(29);
    expect(d!.getHours()).toBe(0);
  });

  it("非法输入返回 null", () => {
    expect(parseLocalDate("not-a-date")).toBeNull();
    expect(parseLocalDate("")).toBeNull();
  });
});

describe("relativeTime", () => {
  const BASE = Date.parse("2026-08-29T03:20:00Z"); // attempted_at=datetime('now') 为 UTC

  it("null / 非法输入 → 空串", () => {
    expect(relativeTime(null, BASE)).toBe("");
    expect(relativeTime("bad", BASE)).toBe("");
  });

  it("不足 1 分钟 → 刚刚", () => {
    expect(relativeTime("2026-08-29 03:20:00", BASE + 59_000)).toBe("刚刚");
  });

  it("不足 1 小时 → N 分钟前", () => {
    expect(relativeTime("2026-08-29 03:20:00", BASE + 5 * 60_000)).toBe("5 分钟前");
    expect(relativeTime("2026-08-29 03:20:00", BASE + 59 * 60_000)).toBe("59 分钟前");
  });

  it("不足 24 小时 → N 小时前（按 UTC 解析 naive 串）", () => {
    expect(relativeTime("2026-08-29 03:20:00", BASE + 3 * 3_600_000)).toBe("3 小时前");
    expect(relativeTime("2026-08-29 03:20:00", BASE + 23 * 3_600_000)).toBe("23 小时前");
  });

  it("更早 → N 天前", () => {
    expect(relativeTime("2026-08-29 03:20:00", BASE + 2 * 86_400_000)).toBe("2 天前");
  });
});

describe("heatmapLevel（深浅只按当日条数 4 档，spec11 契约 D）", () => {
  it("0 / undefined → 档 0（最浅中性，与无记录同色）", () => {
    expect(heatmapLevel(undefined)).toBe(0);
    expect(heatmapLevel(0)).toBe(0);
  });

  it("1-9 → 档 1；10-19 → 档 2；≥20 → 档 3", () => {
    expect(heatmapLevel(1)).toBe(1);
    expect(heatmapLevel(9)).toBe(1);
    expect(heatmapLevel(10)).toBe(2);
    expect(heatmapLevel(19)).toBe(2);
    expect(heatmapLevel(20)).toBe(3);
    expect(heatmapLevel(999)).toBe(3);
  });
});

describe("buildHeatmapCells（近 12 周网格，spec11 修订）", () => {
  // 今天=周六 2026-08-29：本周一=08-24，窗口起点=08-24 - 77 天 = 2026-06-08（周一）
  const TODAY = new Date(2026, 7, 29);
  const START = "2026-06-08";

  const sync = [
    { date: "2026-08-28", status: "ok", error: null },
    { date: "2026-08-20", status: "fetch_failed", error: "upstream 500" },
    { date: "2026-08-19", status: "parse_failed", error: null },
    // 同日先败后成：ok 优先
    { date: "2026-08-18", status: "fetch_failed", error: "timeout" },
    { date: "2026-08-18", status: "ok", error: null },
    // 网格外：未来行与远古行都忽略
    { date: "2099-01-01", status: "ok", error: null },
    { date: "2020-01-01", status: "ok", error: null },
  ];
  const daily = [
    { date: "2026-08-28", items: 22, issues: 1 },
    { date: "2026-08-18", items: 35, issues: 2 },
  ];

  it("恒 84 格，首格=窗口起点周一、末格=本周周日（末列=本周）", () => {
    const cells = buildHeatmapCells(sync, daily, TODAY);
    expect(cells).toHaveLength(84);
    expect(cells[0].date).toBe(START);
    expect(cells[83].date).toBe("2026-08-30"); // 本周日
    expect(cells[77].date).toBe("2026-08-24");
  });

  it("ok 格按当日条数分档（22 条→档 3）；ok 无当日数据→档 0 计 0 条", () => {
    const cells = buildHeatmapCells(sync, daily, TODAY);
    const d28 = cells.find((c) => c.date === "2026-08-28")!;
    expect(d28.status).toBe("ok");
    expect(d28.level).toBe(3);
    expect(d28.tip).toBe("08-28 · ok · 22 条");
    const withOkNoDaily = buildHeatmapCells([{ date: "2026-08-10", status: "ok", error: null }], [], TODAY);
    const c = withOkNoDaily.find((x) => x.date === "2026-08-10")!;
    expect(c.status).toBe("ok");
    expect(c.level).toBe(0);
    expect(c.tip).toBe("08-10 · ok · 0 条");
  });

  it("fail 格 tip 带状态与错误摘要；无记录日=none 且带『无同步记录』tooltip（spec11）", () => {
    const cells = buildHeatmapCells(sync, daily, TODAY);
    const d20 = cells.find((c) => c.date === "2026-08-20")!;
    expect(d20.status).toBe("fail");
    expect(d20.tip).toBe("08-20 · fetch_failed · upstream 500");
    const d27 = cells.find((c) => c.date === "2026-08-27")!; // 无 sync 行的过去日
    expect(d27.status).toBe("none");
    expect(d27.level).toBe(0);
    expect(d27.tip).toBe("08-27 · 无同步记录");
  });

  it("同日先败后成以 ok 为准；今天无记录=none；未来格=future 且 tip 空", () => {
    const cells = buildHeatmapCells(sync, daily, TODAY);
    expect(cells.find((c) => c.date === "2026-08-18")!.status).toBe("ok");
    const todayCell = cells.find((c) => c.date === "2026-08-29")!;
    expect(todayCell.status).toBe("none");
    expect(todayCell.tip).toBe("08-29 · 无同步记录");
    const future = cells.find((c) => c.date === "2026-08-30")!;
    expect(future.status).toBe("future");
    expect(future.tip).toBe("");
  });
});

describe("lineGeometry（稀疏折线坐标）", () => {
  const W = 720;
  const H = 190;
  const PAD = 16;

  it("两点：x 按日期线性、y 按 0..max 反向；path 为 M..L..", () => {
    const g = lineGeometry(
      [
        { date: "2026-08-01", items: 10, issues: 1 },
        { date: "2026-08-11", items: 20, issues: 1 },
      ],
      W,
      H,
      PAD
    );
    expect(g.points).toHaveLength(2);
    expect(g.path).toMatch(/^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+$/);
    expect(g.points[1].x).toBeGreaterThan(g.points[0].x);
    expect(g.points[1].y).toBeLessThan(g.points[0].y); // 条数更多 → 更高
    expect(g.points[1].last).toBe(true);
    expect(g.points[0].last).toBe(false);
    expect(g.points[1].tip).toBe("08-11 · 20 条");
  });

  it("稀疏：中间缺日不画点，线段直接连接两端", () => {
    const g = lineGeometry(
      [
        { date: "2026-08-01", items: 5, issues: 1 },
        { date: "2026-08-03", items: 5, issues: 1 },
      ],
      W,
      H,
      PAD
    );
    expect(g.points).toHaveLength(2); // 08-02 无数据 → 不存在
    expect(g.path).toBe(`M ${g.points[0].x} ${g.points[0].y} L ${g.points[1].x} ${g.points[1].y}`);
  });

  it("单点：path 空串、x 居中", () => {
    const g = lineGeometry([{ date: "2026-08-01", items: 7, issues: 1 }], W, H, PAD);
    expect(g.path).toBe("");
    expect(g.points[0].x).toBeCloseTo(W / 2, 5);
  });

  it("空数组：无点无 path", () => {
    expect(lineGeometry([], W, H, PAD)).toEqual({ points: [], path: "" });
  });
});

describe("donutSegments（环形三段）", () => {
  it("总量为 0 → 空数组（由组件渲染弱化底环）", () => {
    expect(donutSegments({ ok: 0, missing_owner: 0, pending: 0 })).toEqual([]);
  });

  it("三段长度与偏移：len 占比 100、offset 顺序累退", () => {
    const segs = donutSegments({ ok: 988, missing_owner: 128, pending: 0 });
    expect(segs.map((s) => s.key)).toEqual(["ok", "missing_owner", "pending"]);
    // 988/1116=88.5304…、128/1116=11.4695…（原始计数占比，非概览的 0.885 三位收敛值）
    expect(segs[0].len).toBeCloseTo((988 / 1116) * 100, 5);
    expect(segs[1].len).toBeCloseTo((128 / 1116) * 100, 5);
    expect(segs[2].len).toBe(0);
    expect(segs[0].offset).toBe(0);
    expect(segs[1].offset).toBeCloseTo(-(988 / 1116) * 100, 5);
    expect(segs[2].offset).toBeCloseTo(-100, 5);
  });

  it("首段中角自顶端（-90°）顺时针推进；全部为 ok 时单段整圆", () => {
    const segs = donutSegments({ ok: 75, missing_owner: 25, pending: 0 });
    expect(segs[0].midAngle).toBeCloseTo(-90 + (75 / 2) * 3.6, 5); // = +45：顶端起顺时针半段
    expect(segs[1].midAngle).toBeCloseTo(-90 + (75 + 25 / 2) * 3.6, 5); // = +225：首段之后推进
    const full = donutSegments({ ok: 10, missing_owner: 0, pending: 0 });
    expect(full[0].len).toBe(100);
    expect(full[0].offset).toBe(0);
  });
});

describe("展示文案", () => {
  it("pct：三位收敛、去尾零", () => {
    expect(pct(0.885)).toBe("88.5%");
    expect(pct(0.9)).toBe("90%");
    expect(pct(0)).toBe("0%");
    expect(pct(1)).toBe("100%");
  });

  it("shortDate：MM-DD", () => {
    expect(shortDate("2026-08-29")).toBe("08-29");
  });
});

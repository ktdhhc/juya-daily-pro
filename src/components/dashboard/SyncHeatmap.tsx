"use client";

import { useMemo } from "react";
import type { StatsResponse } from "@/lib/api";
import { buildHeatmapCells } from "./chartMath";

const CELL = 13; // 格边长 px
const GAP = 3; // 格间距 px
/** ok 格墨色 4 档（FRONTEND_DESIGN §4.8：color-mix 20/45/70/100%，按当日条数） */
const LEVEL_MIX = ["20%", "45%", "70%", "100%"];

function cellBackground(status: "ok" | "fail" | "empty", level: number): string | undefined {
  if (status === "fail") return "var(--accent)";
  if (status === "ok") return `color-mix(in srgb, var(--fg) ${LEVEL_MIX[level - 1]}, transparent)`;
  return undefined; // 空格：无记录 / 未来格
}

/** 同步热力图（spec08 Step 3.1）：CSS grid 近 12 周（列=周、行=周一至周日，末列=本周，恒 84 格）。
 *  ok 格墨色深浅 4 档按当日条数、失败格朱橙、无记录格空格；hover 格 = .has-tip tooltip
 *  「MM-DD · ok · N 条」或错误摘要；仅展示不跳转。 */
export function SyncHeatmap({
  sync,
  daily,
  today,
}: {
  sync: StatsResponse["sync"];
  daily: StatsResponse["daily"];
  today: Date;
}) {
  // 网格对齐（含同日多行、窗口外日期、未来格）走 chartMath.buildHeatmapCells，不内联
  const cells = useMemo(() => buildHeatmapCells(sync, daily, today), [sync, daily, today]);

  return (
    <div
      className="inline-grid"
      style={{
        gridTemplateRows: `repeat(7, ${CELL}px)`,
        gridAutoFlow: "column",
        gridAutoColumns: `${CELL}px`,
        gap: GAP,
      }}
      role="img"
      aria-label="近 12 周同步热力图"
    >
      {cells.map((c) =>
        c.tip ? (
          <div
            key={c.date}
            className="has-tip relative"
            style={{
              width: CELL,
              height: CELL,
              borderRadius: "var(--radius-content)",
              background: cellBackground(c.status, c.level),
            }}
            data-tip={c.tip}
          />
        ) : (
          <div key={c.date} style={{ width: CELL, height: CELL }} />
        )
      )}
    </div>
  );
}

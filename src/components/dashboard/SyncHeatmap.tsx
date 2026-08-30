"use client";

import { useMemo } from "react";
import type { StatsResponse } from "@/lib/api";
import { buildHeatmapCells } from "./chartMath";

const CELL = 13; // 格边长 px
const GAP = 3; // 格间距 px
/** 墨色档位（spec11 契约 D：深浅只按当日条数 4 档）——档 0=最浅中性 8%（0 条/无记录同色），
 *  1-9 条=35%、10-19 条=60%、≥20 条=100%；失败=朱橙；未来格=纯空 */
const LEVEL_MIX = ["8%", "35%", "60%", "100%"];

function cellBackground(status: "ok" | "fail" | "none" | "future", level: number): string | undefined {
  if (status === "fail") return "var(--accent)";
  if (status === "future") return undefined; // 未来格：纯空
  return `color-mix(in srgb, var(--fg) ${LEVEL_MIX[level]}, transparent)`;
}

/** 同步热力图（spec08 Step 3.1；spec11 契约 D 修订）：CSS grid 近 12 周（列=周、行=周一至周日，
 *  末列=本周，恒 84 格）。84 格全渲染——无记录日最浅中性 + 「无同步记录」tooltip，深浅只按当日
 *  条数四档、失败朱橙、未来格纯空；hover 格 = .has-tip tooltip；仅展示不跳转。 */
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

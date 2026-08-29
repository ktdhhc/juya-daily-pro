"use client";

import Link from "next/link";
import type { StatsResponse } from "@/lib/api";
import { lineGeometry } from "./chartMath";

const W = 640; // viewBox 宽
const H = 160; // viewBox 高
const PAD = 16; // 内边距（几何计算走 chartMath.lineGeometry，不内联）

/** 每日条目折线（spec08 Step 3.1）：1.5px 墨线 + 数据点圆点，末点转强调色（FRONTEND_DESIGN §4.8）。
 *  稀疏日数组（无数据日不画点）；SVG 只画墨线，点为 HTML 覆层 Link——hover 走 .has-tip
 *  tooltip「MM-DD · N 条」，点击跳 /?date=<date>，键盘可达。 */
export function TrendLine({ daily }: { daily: StatsResponse["daily"] }) {
  const { points, path } = lineGeometry(daily, W, H, PAD);

  if (points.length === 0) {
    return (
      <p className="text-xs py-8" style={{ color: "var(--fg-muted)" }}>
        暂无数据
      </p>
    );
  }

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full h-auto" role="img" aria-label="近 90 天每日条目折线">
        {path && (
          <path
            d={path}
            fill="none"
            stroke="var(--fg)"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
      {points.map((p) => (
        <Link
          key={p.date}
          href={`/?date=${p.date}`}
          className="has-tip absolute flex items-center justify-center rounded-full"
          style={{
            left: `${((p.x / W) * 100).toFixed(2)}%`,
            top: `${((p.y / H) * 100).toFixed(2)}%`,
            width: 16,
            height: 16,
            transform: "translate(-50%, -50%)",
          }}
          data-tip={p.tip}
          aria-label={`${p.tip}，查看当日日报`}
        >
          <span
            aria-hidden
            className="block rounded-full"
            style={{
              width: p.last ? 7 : 5,
              height: p.last ? 7 : 5,
              background: p.last ? "var(--accent)" : "var(--fg)",
            }}
          />
        </Link>
      ))}
    </div>
  );
}

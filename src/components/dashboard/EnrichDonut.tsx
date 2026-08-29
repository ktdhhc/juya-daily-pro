"use client";

import { useState } from "react";
import type { DonutSeg } from "./chartMath";
import { donutSegments, pct } from "./chartMath";
import type { StatsResponse } from "@/lib/api";

const SIZE = 160; // viewBox 边长（即渲染边长，px）
const R = 62; // 圆环半径
const STROKE = 14; // 环宽

/** 三段定色（FRONTEND_DESIGN §4.8）：ok=墨 / missing_owner=朱橙 / pending=弱化灰，禁渐变禁彩虹 */
const SEG_COLOR: Record<DonutSeg["key"], string> = {
  ok: "var(--fg)",
  missing_owner: "var(--accent)",
  pending: "var(--fg-muted)",
};
const SEG_LABEL: Record<DonutSeg["key"], string> = {
  ok: "归属完成",
  missing_owner: "缺归属",
  pending: "待解析",
};

/** 归属状态环形（spec08 Step 3.1）：stroke-dasharray + pathLength=100 归一化分段（几何走 chartMath
 *  .donutSegments，不内联），中心「归属率 NN%」；hover 段 = 受控浮层（SVG 内元素不支持 ::after）
 *  锚定段中角；不做点击跳转。 */
export function EnrichDonut({ enrich, rate }: { enrich: StatsResponse["enrich"]; rate: number }) {
  const segs = donutSegments(enrich);
  const [hover, setHover] = useState<DonutSeg | null>(null);

  // 浮层锚点：段中角（-90°=顶端、顺时针为正，chartMath 约定）→ 环外 10px 处
  const rad = hover ? (hover.midAngle * Math.PI) / 180 : 0;
  const anchorR = R + STROKE / 2 + 10;
  const ax = hover ? ((SIZE / 2 + anchorR * Math.cos(rad)) / SIZE) * 100 : 0;
  const ay = hover ? ((SIZE / 2 + anchorR * Math.sin(rad)) / SIZE) * 100 : 0;

  return (
    <div className="relative inline-block" style={{ width: SIZE, height: SIZE }}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} role="img" aria-label={`归属率 ${pct(rate)}`}>
        <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
          {/* 纸面轨道：空数据时环形仍有形 */}
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            strokeWidth={STROKE}
            stroke="color-mix(in srgb, var(--fg) 6%, transparent)"
          />
          {segs.map((s) => (
            <circle
              key={s.key}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              fill="none"
              stroke={SEG_COLOR[s.key]}
              strokeWidth={hover?.key === s.key ? STROKE + 3 : STROKE}
              strokeDasharray={`${s.len} ${100 - s.len}`}
              strokeDashoffset={s.offset}
              pathLength={100}
              onMouseEnter={() => setHover(s)}
              onMouseLeave={() => setHover(null)}
              style={{
                cursor: "default",
                pointerEvents: s.value === 0 ? "none" : "stroke",
                transition: "stroke-width var(--dur-fast) var(--ease-out)",
              }}
            />
          ))}
        </g>
      </svg>

      {/* 中心数字：HTML 覆层，字体与排版控制比 SVG text 直接 */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="stat-label">归属率</span>
        <span className="stat-num mt-1">{pct(rate)}</span>
      </div>

      {/* 段 tooltip：受控浮层，视觉与 .has-tip::after 同款（§4.8） */}
      {hover && (
        <div
          className="absolute fade-up"
          style={{
            left: `${ax.toFixed(2)}%`,
            top: `${ay.toFixed(2)}%`,
            transform: "translate(-50%, -50%)",
            padding: "3px 8px",
            borderRadius: "var(--radius-control)",
            background: "var(--fg)",
            color: "var(--bg)",
            fontSize: 11,
            fontWeight: 500,
            lineHeight: 1.4,
            whiteSpace: "nowrap",
            pointerEvents: "none",
            zIndex: 40,
            boxShadow: "var(--shadow-overlay)",
          }}
        >
          {SEG_LABEL[hover.key]} · {hover.value} 条
        </div>
      )}
    </div>
  );
}

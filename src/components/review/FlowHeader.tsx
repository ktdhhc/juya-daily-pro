"use client";

import { FlowSegment } from "@/lib/review";

interface Props {
  /** 三段流水线数据（flowCounts 纯函数产出，spec13 契约 E） */
  segments: { sync: FlowSegment; parse: FlowSegment; published: FlowSegment };
  /** 点击段落平滑滚动：① 条目区顶部 / ② 解析区 / ③ 发布条（目标未渲染则父层静默） */
  onJump: (target: "staged" | "parse" | "published") => void;
}

/** 数据流标头（spec13 契约 E）：审核台标题之下三段流水线横条——
 *  「① 已同步 · 暂存 N 条 → ② 解析 · 状态 → ③ 已入库 · X 期 Y 条」，三段流动一眼可读；
 *  每段可点击平滑滚动到对应区块。运行中②段呼吸点标（.breath-dot，CSS opacity 脉冲，禁发光）。 */
export function FlowHeader({ segments, onJump }: Props) {
  const items: { key: "staged" | "parse" | "published"; num: string; seg: FlowSegment }[] = [
    { key: "staged", num: "①", seg: segments.sync },
    { key: "parse", num: "②", seg: segments.parse },
    { key: "published", num: "③", seg: segments.published },
  ];
  return (
    <nav className="rule-t mt-3" aria-label="数据流水线">
      <div
        className="max-w-6xl mx-auto px-5 py-1.5 text-xs flex items-center gap-2.5 flex-wrap"
        style={{ color: "var(--fg-muted)", fontVariantNumeric: "tabular-nums" }}
      >
        {items.map(({ key, num, seg }, i) => (
          <span key={key} className="flex items-center gap-2.5 min-w-0">
            {i > 0 && (
              <span aria-hidden className="shrink-0">
                →
              </span>
            )}
            <button
              type="button"
              className="flex items-center gap-1 min-w-0 cursor-pointer hover:opacity-80"
              style={{
                color: seg.tone === "accent" ? "var(--accent)" : "inherit",
                fontFamily: "inherit",
                fontSize: "inherit",
                background: "none",
                border: "none",
                padding: 0,
              }}
              onClick={() => onJump(key)}
            >
              <span aria-hidden className="shrink-0">
                {num}
              </span>
              <span className="min-w-0 truncate">{seg.label}</span>
              {seg.tone === "pulse" && (
                <span aria-hidden className="breath-dot shrink-0" style={{ color: "var(--fg)" }}>
                  ●
                </span>
              )}
            </button>
          </span>
        ))}
      </div>
    </nav>
  );
}

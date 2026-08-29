"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LogoSeal } from "../common/LogoSeal";
import type { StatsResponse } from "@/lib/api";

/** 横向墨条两组（spec08 Step 3.1）：分类全量 → /stream?category=、公司 Top12 → /company/<id>。
 *  沿用 .dist-* 行语言（FRONTEND_DESIGN §4.8）；公司行内嵌 LogoSeal 小印（素材取 logos.generated，
 *  缺省回退首字印；/api/stats 不含公司色，回退印用墨色）；条宽按组内 max 比例，入场从 0 展开；
 *  行 hover = .has-tip tooltip「名称 · N 条」。 */
export function RankBars({
  categories,
  companies,
}: {
  categories: StatsResponse["categories"];
  companies: StatsResponse["companies"];
}) {
  // 条形入场：挂载后从 0 展开（与 CompanyProfile 分类分布同款，500ms --ease-out）
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const catMax = Math.max(1, ...categories.map((c) => c.count));
  const comMax = Math.max(1, ...companies.map((c) => c.count));

  return (
    <div className="grid md:grid-cols-2 gap-x-12 gap-y-7">
      <div className="min-w-0">
        <h3 className="stat-label">分类 · 全量</h3>
        <div className="mt-3 flex flex-col gap-1">
          {categories.map((c) => (
            <Link
              key={c.category}
              href={`/stream?category=${encodeURIComponent(c.category)}`}
              className="dist-row has-tip relative group rounded-[var(--radius-control)] px-2 py-1 -mx-2 hover:bg-[var(--bg-warm)]"
              data-tip={`${c.category} · ${c.count} 条`}
            >
              <span className="text-xs truncate transition-colors duration-150 text-[var(--fg-light)] group-hover:text-[var(--fg)]">
                {c.category}
              </span>
              <div className="dist-track">
                <div
                  className="dist-bar"
                  style={{ width: grown ? `${((c.count / catMax) * 100).toFixed(1)}%` : "0%" }}
                />
              </div>
              <span
                className="text-xs text-right transition-colors duration-150 text-[var(--fg-muted)] group-hover:text-[var(--fg)]"
                style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}
              >
                {c.count}
              </span>
            </Link>
          ))}
        </div>
      </div>

      <div className="min-w-0">
        <h3 className="stat-label">公司 · Top {companies.length}</h3>
        <div className="mt-3 flex flex-col gap-1">
          {companies.map((c) => (
            <Link
              key={c.id}
              href={`/company/${c.id}`}
              className="dist-row has-tip relative group rounded-[var(--radius-control)] px-2 py-1 -mx-2 hover:bg-[var(--bg-warm)]"
              style={{ gridTemplateColumns: "minmax(0, 148px) minmax(0, 1fr) 32px" }}
              data-tip={`${c.name} · ${c.count} 条`}
            >
              <span className="flex items-center gap-1.5 min-w-0">
                <LogoSeal id={c.id} name={c.name} color="var(--fg)" size={18} fontSize={10} ariaHidden />
                <span className="text-xs truncate transition-colors duration-150 text-[var(--fg-light)] group-hover:text-[var(--fg)]">
                  {c.name}
                </span>
              </span>
              <div className="dist-track">
                <div
                  className="dist-bar"
                  style={{ width: grown ? `${((c.count / comMax) * 100).toFixed(1)}%` : "0%" }}
                />
              </div>
              <span
                className="text-xs text-right transition-colors duration-150 text-[var(--fg-muted)] group-hover:text-[var(--fg)]"
                style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}
              >
                {c.count}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

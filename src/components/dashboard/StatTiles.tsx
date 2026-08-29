"use client";

import { useMemo } from "react";
import type { StatsResponse } from "@/lib/api";
import { pct, relativeTime } from "./chartMath";

type Overview = StatsResponse["overview"];

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="stat-label">{label}</div>
      <div className="stat-num mt-1.5 truncate">{value}</div>
      {sub && (
        <div className="text-xs mt-1 truncate" style={{ color: "var(--fg-muted)", fontVariantNumeric: "tabular-nums" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

/** 总览五块（spec08 Step 3.1）：期数 / 条目 / 公司 / 归属率 / 最近同步，tabular 数字 + rule-t 分隔。
 *  相对时间挂载时算一次，不做定时刷新（FRONTEND_DESIGN §4.8）。 */
export function StatTiles({ overview }: { overview: Overview }) {
  // lastSyncAt 为 UTC naive（chartMath 约定），按 UTC 解析后与客户端挂钟比较
  const rel = useMemo(() => relativeTime(overview.lastSyncAt), [overview.lastSyncAt]);
  // "2026-08-29 03:20:00" → "08-29 03:20"
  const abs = overview.lastSyncAt ? overview.lastSyncAt.slice(5, 16) : "";

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-x-6 gap-y-5">
      <Tile label="期数" value={String(overview.issues)} />
      <Tile label="条目" value={String(overview.items)} />
      <Tile label="公司" value={String(overview.companies)} />
      <Tile label="归属率" value={pct(overview.attributedRate)} />
      <Tile label="最近同步" value={rel || "—"} sub={abs} />
    </div>
  );
}

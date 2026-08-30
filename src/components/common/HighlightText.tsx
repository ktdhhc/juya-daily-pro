"use client";

import { Fragment } from "react";

// 命中位置纯计算（可单测）：query（trim 后）在 text 中的全部出现区间 [start, end)，
// 大小写不敏感、不重叠；query 为空/无命中 → 空数组。
export function matchRanges(text: string, query: string): Array<[number, number]> {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];
  const lower = text.toLowerCase();
  const ranges: Array<[number, number]> = [];
  let i = 0;
  while ((i = lower.indexOf(needle, i)) >= 0) {
    ranges.push([i, i + needle.length]);
    i += needle.length;
  }
  return ranges;
}

/** 搜索关键词高亮（spec11 契约 F）：命中段包 <mark>（样式见 globals.css），其余原文段原样渲染——
 *  拆分为 Fragment + mark，不用 dangerouslySetInnerHTML；query 空/无命中 → 原文。 */
export function HighlightText({ text, query }: { text: string; query: string }) {
  const ranges = matchRanges(text, query);
  if (ranges.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) parts.push(<Fragment key={`t${cursor}`}>{text.slice(cursor, start)}</Fragment>);
    parts.push(<mark key={`m${start}`}>{text.slice(start, end)}</mark>);
    cursor = end;
  }
  if (cursor < text.length) parts.push(<Fragment key={`t${cursor}`}>{text.slice(cursor)}</Fragment>);
  return <>{parts}</>;
}

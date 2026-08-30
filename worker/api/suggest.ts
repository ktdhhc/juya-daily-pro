// suggest — spec11 契约 C：搜索联想的纯函数层（摘要命中片段）。
// 路由层（routes.ts）负责查询与组装；本文件只做文本截取，无 IO（ADR-0011 可单测）。

// summary 中找 q（大小写不敏感）→ 命中词前后各约 40 字符的纯文本片段：
// 截断侧加「…」；无命中 → 前 80 字符（超长加「…」）；空 summary → 空串；空白 q 按无命中。
export function summarizeMatch(summary: string, q: string): string {
  if (summary === "") return "";
  const needle = q.trim();
  if (needle === "") return sliceWithEllipsis(summary, 0, 80);
  const idx = summary.toLowerCase().indexOf(needle.toLowerCase());
  if (idx < 0) return sliceWithEllipsis(summary, 0, 80);
  const start = Math.max(0, idx - 40);
  const end = Math.min(summary.length, idx + needle.length + 40);
  return sliceWithEllipsis(summary, start, end);
}

// [start, end) 截取，截断侧补「…」
function sliceWithEllipsis(text: string, start: number, end: number): string {
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return prefix + text.slice(start, end) + suffix;
}

// parseArchiveDates — archive 页 HTML → 期日期列表（YYYY-MM-DD）的纯函数解析器（spec02 2.1）。
// 纯函数：无 fetch / fs / process / Cloudflare 专属 API（ADR-0011 只测纯函数）。
// 规则：提取全部 YYYY-MM-DD，去重，倒序（最新在前）。

const RE_DATE = /\d{4}-\d{2}-\d{2}/g;

export function parseArchiveDates(html: string): string[] {
  const matches = html.match(RE_DATE) ?? [];
  return [...new Set(matches)].sort().reverse(); // ISO 日期字典序 = 时间序；倒序即最新在前
}

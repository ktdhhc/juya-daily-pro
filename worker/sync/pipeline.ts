// pipeline — spec05 Step 1.1：手动增量同步的窗口选择纯函数。
// 纯函数：无 fetch / fs / process / Cloudflare 专属 API（ADR-0011 只测纯函数）。
// 日期均为 YYYY-MM-DD（等长 ISO 形态，字典序 = 时间序）。

// selectSyncDates — 从 archive 期列表选出本次需要拉取的日期：
// archive ∩ [maxItemDate − lookbackDays, +∞)，升序返回（执行序）。
// maxItemDate 为 null（items 空库）→ 全部 archive 日期（升序）。
// 窗口下限按 UTC 日历日计算（Date.UTC + toISOString），不受本地时区影响；
// 无上限过滤（archive 未来期罕见，出现亦拉取，upsert 幂等）。
export function selectSyncDates(
  archiveDates: string[],
  maxItemDate: string | null,
  lookbackDays: number,
): string[] {
  if (maxItemDate === null) return [...archiveDates].sort();
  const [y, m, d] = maxItemDate.split("-").map(Number);
  const dayMs = 24 * 60 * 60 * 1000;
  const floor = new Date(Date.UTC(y, m - 1, d) - lookbackDays * dayMs).toISOString().slice(0, 10);
  return archiveDates.filter((date) => date >= floor).sort();
}

// classifyWindow — 同步窗口三分类（消息诚实化）：逐期比对抓取内容与库内现存的 markdown，
// 分为 新增（不在库）/ 有更新（在库且内容不同）/ 未变化（在库且内容相同）。
// 只影响响应口径与提示语；写库行为不变（每期照常重匹配，注册新公司后点同步仍能补归属）。
export function classifyWindow(
  fetched: { date: string; markdown: string }[],
  existing: ReadonlyMap<string, string>,
): { added: string[]; updated: string[]; unchanged: string[] } {
  const out = { added: [] as string[], updated: [] as string[], unchanged: [] as string[] };
  for (const { date, markdown } of fetched) {
    const stored = existing.get(date);
    if (stored === undefined) out.added.push(date);
    else if (stored === markdown) out.unchanged.push(date);
    else out.updated.push(date);
  }
  return out;
}

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

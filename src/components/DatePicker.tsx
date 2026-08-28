"use client";

import { useEffect } from "react";
import { DailyEntry } from "@/lib/juya";

interface Props {
  entries: DailyEntry[];
  currentDate?: string;
  onSelect: (entry: DailyEntry) => void;
  open: boolean;
  onClose: () => void;
}

function groupByMonth(entries: DailyEntry[]) {
  const map = new Map<string, DailyEntry[]>();
  for (const entry of entries) {
    const [y, m] = entry.date.split("-");
    const key = `${y}-${m}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(entry);
  }
  return Array.from(map.entries()).map(([key, items]) => {
    const [y, m] = key.split("-");
    return { year: y, month: parseInt(m, 10), entries: items };
  });
}

/** Get the day-of-week offset for the 1st of a month (0=Sun) */
function getFirstDayOffset(year: number, month: number) {
  return new Date(year, month - 1, 1).getDay();
}

/** Get total days in a month */
function getDaysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

// 竖排月份「二〇二六年八月」
const CN_DIGITS = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
function cnYear(y: number): string {
  return String(y)
    .split("")
    .map((d) => CN_DIGITS[Number(d)] ?? d)
    .join("");
}
function cnMonth(m: number): string {
  const names = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"];
  return `${names[m - 1]}月`;
}

/** 合订本日期索引（FRONTEND_DESIGN §4.4）：浮层 token + 按月分节（竖排月份 + 裸数字网格），
 *  当前阅读期数字上压小方印，月份节 20ms 逐项 stagger。数据模型与交互（选期回传 entry）不变。 */
export function DatePicker({ entries, currentDate, onSelect, open, onClose }: Props) {
  const groups = groupByMonth(entries);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="合订本目录">
      <div className="absolute inset-0 overlay-backdrop bg-black/30" onClick={onClose} />

      <div
        className="overlay-panel relative z-10 w-full max-w-[460px] max-h-[72dvh] overflow-y-auto p-5"
        style={{ background: "var(--bg-card)" }}
      >
        {/* 表头：细线划题 */}
        <div className="flex items-baseline gap-3 pl-1 pb-2">
          <span className="text-xs" style={{ color: "var(--fg-muted)", letterSpacing: "0.3em" }}>
            合订本 · 目录
          </span>
          <span className="h-px flex-1" style={{ background: "var(--rule)" }} aria-hidden />
          <button onClick={onClose} className="icon-btn -mr-1" aria-label="关闭目录">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {groups.map((g, gi) => {
          const year = parseInt(g.year, 10);
          const month = g.month;
          const firstOffset = getFirstDayOffset(year, month);
          const totalDays = getDaysInMonth(year, month);

          const availableDates = new Map<number, DailyEntry>();
          for (const entry of g.entries) {
            const day = new Date(entry.date + "T00:00:00").getDate();
            availableDates.set(day, entry);
          }

          return (
            <section
              key={`${g.year}-${g.month}`}
              className="month-sec"
              style={{ animationDelay: `${Math.min(gi, 10) * 20}ms` }}
            >
              <span className="v-label month-label" aria-hidden>
                {cnYear(year)}
                {cnMonth(month)}
              </span>
              <div className="day-grid">
                {Array.from({ length: firstOffset }).map((_, i) => (
                  <span key={`pad-${i}`} />
                ))}
                {Array.from({ length: totalDays }).map((_, i) => {
                  const day = i + 1;
                  const entry = availableDates.get(day);
                  const isCurrent = entry?.date === currentDate;
                  const isToday = (() => {
                    const now = new Date();
                    return now.getFullYear() === year && now.getMonth() + 1 === month && now.getDate() === day;
                  })();

                  if (!entry) {
                    return (
                      <span key={day} className="day-num is-empty" aria-hidden>
                        {day}
                      </span>
                    );
                  }
                  return (
                    <button
                      key={day}
                      onClick={() => onSelect(entry)}
                      className={`day-num${isCurrent ? " current" : ""}${isToday && !isCurrent ? " today" : ""}`}
                      aria-current={isCurrent ? "date" : undefined}
                      aria-label={entry.date}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

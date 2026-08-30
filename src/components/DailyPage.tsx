"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { DailyEntry, ParsedDaily, parseMarkdown, MD_BASE } from "@/lib/juya";
import { Header } from "./Header";
import { DatePicker } from "./DatePicker";
import { ArticleView, scrollToId } from "./ArticleView";
import { TimelineRail } from "./stream/TimelineRail";

interface Props {
  entries: DailyEntry[];
  initialData: ParsedDaily | null;
  initialIssueId: number;
  initialDate: string;
  error?: string;
}

/** 骨架：.galley 结构同构块 + 定制墨迹扫过 + 竖排「排版中 …」（FRONTEND_DESIGN §4.5，替代 animate-pulse） */
function ArticleSkeleton() {
  return (
    <div className="max-w-3xl mx-auto px-5 py-8 md:py-12 relative" aria-busy="true">
      {/* Date line */}
      <div className="flex items-center gap-3 mb-3">
        <div className="galley h-3 w-24" />
        <div className="h-px flex-1" style={{ background: "var(--rule)" }} />
        <div className="galley h-3 w-12" />
      </div>
      {/* Title */}
      <div className="galley h-10 w-56 mb-2.5" />
      <div className="galley h-4 w-40 mb-8" />
      {/* Overview block */}
      <div className="p-5 mb-8" style={{ borderRadius: "var(--radius-content)", background: "var(--tag-bg)" }}>
        <div className="galley h-3 w-16 mb-4" />
        <div className="space-y-2.5">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="galley h-3" style={{ width: `${85 - i * 8}%` }} />
          ))}
        </div>
      </div>
      {/* Content blocks */}
      <div className="space-y-8">
        {[...Array(4)].map((_, i) => (
          <div key={i}>
            <div className="galley h-5 w-3/4 mb-3" />
            <div className="space-y-2">
              <div className="galley h-3 w-full" />
              <div className="galley h-3 w-full" />
              <div className="galley h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
      <span className="v-label absolute left-5 bottom-6" aria-hidden>
        排版中 …
      </span>
    </div>
  );
}

export function DailyPage({
  entries,
  initialData,
  initialIssueId,
  initialDate,
  error,
}: Props) {
  const [data, setData] = useState(initialData);
  const [issueId, setIssueId] = useState(initialIssueId);
  const [currentDate, setCurrentDate] = useState(initialDate);
  const [loading, setLoading] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

  // Sync when initialData arrives from parent
  useEffect(() => {
    if (initialData) setData(initialData);
  }, [initialData]);
  useEffect(() => {
    if (initialIssueId) setIssueId(initialIssueId);
  }, [initialIssueId]);
  useEffect(() => {
    if (!initialDate) return;
    setCurrentDate(initialDate);
    // 首次加载也把日期写进地址栏，方便直接复制分享（保留 hash 锚点，spec06 B1）
    const params = new URLSearchParams(window.location.search);
    if (!params.get("date")) {
      window.history.replaceState({ date: initialDate }, "", `${window.location.pathname}?date=${initialDate}${window.location.hash}`);
    }
  }, [initialDate]);

  // 锚点消费（spec06 B1）：数据就绪后的 commit 里 h3 已在 DOM，读 location.hash（#article-N）
  // 滚到对应条目；覆盖 initialData 到达与 handleSelect 完成（popstate 带锚点返回）两条路径，
  // 滚动逻辑复用 ArticleView 的 scrollToId——元素不存在（当日无该编号）静默留顶部。
  // 深链落位用 "auto" 瞬时：原生 #锚点语义，不依赖运行环境的 smooth 动画（IAB 内 smooth 被吞，spec06 C 线实测）
  useEffect(() => {
    if (!data) return;
    const m = /^#article-(\d+)$/.exec(window.location.hash);
    if (!m) return;
    scrollToId(`article-${m[1]}`, mainRef.current, "auto");
  }, [data, issueId]);

  const handleSelect = useCallback(async (entry: DailyEntry, updateUrl = true) => {
    setLoading(true);
    setCalendarOpen(false);
    try {
      const res = await fetch(`${MD_BASE}/${entry.filename}`);
      const md = await res.text();
      const parsed = parseMarkdown(md);
      setData(parsed);
      setIssueId(entry.id);
      setCurrentDate(entry.date);
      // 切换时把当前期写进地址栏，形成可分享/收藏的单独链接
      if (updateUrl) {
        window.history.pushState({ date: entry.date }, "", `${window.location.pathname}?date=${entry.date}`);
      }
      mainRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      console.error("Failed to load:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // 浏览器前进/后退时，按地址栏的 ?date= 切换
  useEffect(() => {
    const onPop = () => {
      const wantDate = new URLSearchParams(window.location.search).get("date");
      const entry = (wantDate && entries.find((e) => e.date === wantDate)) || entries[0];
      if (entry && entry.id !== issueId) handleSelect(entry, false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [entries, issueId, handleSelect]);

  const contentLoading = !data || loading;
  // 刊号：当前期在归档中的位置（entries 按日期降序，第 1 期 = 最新）
  const currentIdx = entries.findIndex((e) => e.date === currentDate);
  const issueNo = currentIdx >= 0 ? entries.length - currentIdx : null;

  return (
    <div
      className="h-dvh flex flex-col overflow-hidden"
      style={{ background: "var(--bg)" }}
    >
      {/* Header always visible immediately */}
      <Header
        mainRef={mainRef}
        active="daily"
        currentDate={currentDate || ""}
        issueNo={issueNo}
        onCalendarToggle={() => setCalendarOpen((v) => !v)}
        hasEntries={entries.length > 0}
      />

      <main
        ref={mainRef}
        className="flex-1 min-w-0 overflow-y-auto"
      >
        {error ? (
          <div className="flex items-center justify-center py-32">
            <p className="text-sm" style={{ color: "var(--fg-muted)" }}>{error}</p>
          </div>
        ) : contentLoading ? (
          <ArticleSkeleton />
        ) : (
          <ArticleView data={data} issueId={issueId} mainRef={mainRef} entries={entries} onSelect={handleSelect} />
        )}
      </main>

      {/* 阅读时间线（spec11 §4.10）：当期条目刻度轨，lg+ 视口；骨架/错误态不出现 */}
      {!error && !contentLoading && data !== null && (
        <TimelineRail mainRef={mainRef} dataKey={`${issueId}-${data.date}`} />
      )}

      {entries.length > 0 && (
        <DatePicker
          entries={entries}
          currentDate={currentDate}
          onSelect={handleSelect}
          open={calendarOpen}
          onClose={() => setCalendarOpen(false)}
        />
      )}
    </div>
  );
}

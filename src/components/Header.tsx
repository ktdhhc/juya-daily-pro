"use client";

import { useEffect, useState, RefObject } from "react";
import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";

export type HeaderActive = "daily" | "stream" | "company";

interface Props {
  mainRef?: RefObject<HTMLElement | null>;
  currentDate?: string;
  /** 刊号：第 N 期（由 DailyPage 按日期在归档中的位置推算） */
  issueNo?: number | null;
  onCalendarToggle?: () => void;
  hasEntries?: boolean;
  active?: HeaderActive;
}

const NAV_ITEMS: { key: HeaderActive; label: string; href: string }[] = [
  { key: "daily", label: "日报", href: "/" },
  { key: "stream", label: "事件流", href: "/stream" },
  { key: "company", label: "公司", href: "/company" },
];

/** 全站共用报头（FRONTEND_DESIGN §4.1）。
 *  阅读页专属控件（进度条 / 复制链接 / 外链 / 日历入口 / 刊号）仅在 active="daily" 时出现。 */
export function Header({ mainRef, currentDate, issueNo, onCalendarToggle, hasEntries, active }: Props) {
  const [progress, setProgress] = useState(0);
  const [copied, setCopied] = useState(false);
  const isDaily = active === "daily" || active === undefined;

  const copyLink = async () => {    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  useEffect(() => {
    const container = mainRef?.current;
    if (!container) return;
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const max = scrollHeight - clientHeight;
      setProgress(max > 0 ? scrollTop / max : 0);
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [mainRef]);

  return (
    <header className="site-header sticky top-0 z-50 shrink-0">
      <div className="px-5 h-12 flex items-center">
        {/* 品牌：方印 + 站名 */}
        <Link href="/" className="flex items-center gap-2.5 no-underline shrink-0 mr-8">
          <span className="seal" style={{ width: 26, height: 26, fontSize: 15 }} aria-hidden>
            橘
          </span>
          <span className="site-brand text-base font-bold tracking-tight">橘鸦 AI 日报</span>
        </Link>

        {/* Nav 三联：宽字距，激活 3px 墨线，hover 自左展开 */}
        <nav className="h-12 hidden sm:flex items-center" aria-label="主导航">
          {NAV_ITEMS.map((n) => (
            <Link
              key={n.key}
              href={n.href}
              className={`nav-link${active === n.key ? " active" : ""}`}
              aria-current={active === n.key ? "page" : undefined}
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-1 ml-auto">
          {isDaily && issueNo != null && currentDate && (
            <span
              className="mr-2 text-xs whitespace-nowrap"
              style={{ color: "var(--fg-muted)", fontVariantNumeric: "tabular-nums" }}
            >
              第 {issueNo} 期 · {currentDate}
            </span>
          )}
          {isDaily && hasEntries && (
            <button onClick={onCalendarToggle} className="icon-btn" aria-label="打开合订本目录" title="合订本目录">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </button>
          )}
          {isDaily && hasEntries && (
            <button
              onClick={copyLink}
              className="icon-btn"
              style={copied ? { color: "var(--accent)" } : undefined}
              title="复制本期链接"
              aria-label="复制本期链接"
            >
              {copied ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
              )}
            </button>
          )}
          {isDaily && (
            <a
              href="https://daily.juya.uk"
              target="_blank"
              rel="noopener noreferrer"
              className="icon-btn"
              aria-label="橘鸦 AI 日报官网"
              title="官网"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 17L17 7" />
                <path d="M8 7h9v9" />
              </svg>
            </a>
          )}
          <ThemeToggle />
        </div>
      </div>
      {isDaily && <div className="reading-progress" style={{ transform: `scaleX(${progress})` }} />}
    </header>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState, RefObject } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ThemeToggle } from "./ThemeToggle";
import { AdminGate } from "./common/AdminGate";
import { HighlightText } from "./common/HighlightText";
import { ApiError, fetchPendingReview, fetchSuggest, triggerSync, type SuggestItem } from "@/lib/api";
import { clearAdminToken, isAdmin } from "@/lib/auth";

export type HeaderActive = "daily" | "stream" | "company" | "review" | "dashboard";

interface Props {
  mainRef?: RefObject<HTMLElement | null>;
  currentDate?: string;
  /** 刊号：第 N 期（由 DailyPage 按日期在归档中的位置推算） */
  issueNo?: number | null;
  onCalendarToggle?: () => void;
  hasEntries?: boolean;
  active?: HeaderActive;
  /** 报头搜索提交（spec06 B3）：/stream 传入以并入 facet 双向同步；缺省 router.push 跳 /stream?query= */
  onSearch?: (term: string) => void;
}

const NAV_ITEMS: { key: HeaderActive; label: string; href: string; adminOnly?: boolean }[] = [
  { key: "daily", label: "日报", href: "/" },
  { key: "stream", label: "事件流", href: "/stream" },
  { key: "company", label: "公司", href: "/company" },
  // 数据面板（spec08 3.2）：仅管理员态渲染（复用 Header 内 admin 角色态，AdminGate 升级后同步出现）
  { key: "dashboard", label: "面板", href: "/dashboard", adminOnly: true },
];

/** 全站共用报头（FRONTEND_DESIGN §4.1）。
 *  阅读页专属控件（进度条 / 复制链接 / 外链 / 日历入口 / 刊号）仅在 active="daily" 时出现；
 *  搜索 icon-btn 全视图可见（spec06 B3）；同步 icon-btn 与「退出管理」仅管理员态渲染（spec07 2.3/2.4）。 */
export function Header({ mainRef, currentDate, issueNo, onCalendarToggle, hasEntries, active, onSearch }: Props) {
  const router = useRouter();
  const [progress, setProgress] = useState(0);
  const [copied, setCopied] = useState(false);
  const isDaily = active === "daily" || active === undefined;

  // 统一搜索（spec06 B3）：放大镜展开报头下方全宽搜索条，Esc 收起，Enter 跳 /stream?query=
  const [searchOpen, setSearchOpen] = useState(false);
  const [term, setTerm] = useState("");

  const submitSearch = () => {
    const t = term.trim();
    if (!t) return;
    setSearchOpen(false);
    setTerm("");
    if (onSearch) onSearch(t);
    else router.push(`/stream?query=${encodeURIComponent(t)}`);
  };

  // 搜索联想（spec11 契约 F）：输入 ≥1 字符 250ms debounce 调 suggest；序号守卫保证仅
  // 最后一次请求可渲染；↑↓ 移动选中、Enter 选中则跳条目否则提交、Esc 收起。
  const [suggests, setSuggests] = useState<SuggestItem[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const suggestSeq = useRef(0);

  useEffect(() => {
    const q = term.trim();
    if (!searchOpen || q === "") {
      setSuggests([]);
      setSuggestOpen(false);
      setActiveIdx(-1);
      return;
    }
    const timer = setTimeout(() => {
      const seq = ++suggestSeq.current;
      fetchSuggest(q)
        .then((r) => {
          if (seq !== suggestSeq.current) return; // 竞态：仅最后一次请求生效
          setSuggests(r.items);
          setSuggestOpen(r.items.length > 0);
          setActiveIdx(-1);
        })
        .catch(() => {}); // 联想失败静默（搜索条本身可用）
    }, 250);
    return () => clearTimeout(timer);
  }, [term, searchOpen]);

  const gotoSuggestion = (s: SuggestItem) => {
    setSuggestOpen(false);
    setSearchOpen(false);
    setTerm("");
    const hash = s.sequenceInt > 0 ? `#article-${s.sequenceInt}` : "";
    router.push(`/?date=${s.date}${hash}`);
  };

  const onSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setSuggestOpen(false);
      setSearchOpen(false);
    } else if (e.key === "ArrowDown" && suggestOpen && suggests.length > 0) {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % suggests.length);
    } else if (e.key === "ArrowUp" && suggestOpen && suggests.length > 0) {
      e.preventDefault();
      setActiveIdx((i) => (i <= 0 ? suggests.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      const picked = activeIdx >= 0 ? suggests[activeIdx] : undefined;
      if (picked) gotoSuggestion(picked);
      else submitSearch();
    }
  };

  // 管理员态（spec07 2.3/2.4）：挂载后读一次 localStorage（静态导出首帧按访客渲染避免水合错位）；
  // 不监听 storage 事件，跨页由各页 Header 挂载时各自读取
  const [admin, setAdmin] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  useEffect(() => setAdmin(isAdmin()), []);

  // 审核·N（spec10 3.2）：管理员态挂载时查一次待审期数；失败静默（角标缺省不显示）
  const [pendingCount, setPendingCount] = useState(0);
  useEffect(() => {
    if (!admin) return;
    let alive = true;
    fetchPendingReview()
      .then((p) => {
        if (alive) setPendingCount(p.dates.length);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [admin]);

  // 同步按钮（spec06 B4）：POST /api/sync，运行中旋转，成功细线小条约 5s 自散，失败一行错误 + 重试
  const [syncPhase, setSyncPhase] = useState<"idle" | "running" | "ok" | "fail">("idle");
  const [syncMsg, setSyncMsg] = useState("");
  const syncingRef = useRef(false);

  const runSync = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncPhase("running");
    try {
      const res = await triggerSync();
      if (res.ok) {
        // spec11 契约 A：stagedDates=真有暂存的期（权威口径）；空 → 无待审，不再误报「待审核」
        setSyncMsg(
          res.stagedDates.length > 0
            ? `同步 ${res.dates.length} 期 · ${res.stagedDates.length} 期待审核${res.failures.length > 0 ? ` · 失败 ${res.failures.length}` : ""}`
            : `同步 ${res.dates.length} 期${res.failures.length > 0 ? ` · 失败 ${res.failures.length}` : ""}`
        );
        setSyncPhase("ok");
      } else {
        const f = res.failures[0];
        setSyncMsg(f ? `${f.date} · ${f.error}` : "同步失败");
        setSyncPhase("fail");
      }
    } catch (e) {
      setSyncMsg(
        e instanceof ApiError
          ? e.code === "unauthorized"
            ? "需要管理口令"
            : e.message
          : "网络异常，请稍后重试"
      );
      setSyncPhase("fail");
    } finally {
      syncingRef.current = false;
    }
  }, []);

  // 成功小条约 5s 自散；失败 / 403 提示保留至下次操作（spec06 B4）
  useEffect(() => {
    if (syncPhase !== "ok") return;
    const t = setTimeout(() => setSyncPhase("idle"), 5000);
    return () => clearTimeout(t);
  }, [syncPhase]);

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
          {NAV_ITEMS.filter((n) => !n.adminOnly || admin).map((n) => (
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
          {/* 审核入口（spec10 3.2）：仅管理员态渲染；待审期数 >0 时带 ·N 角标 */}
          {admin && (
            <Link
              href="/review"
              className="text-link text-xs shrink-0 mr-2"
              aria-label={pendingCount > 0 ? `审核（${pendingCount} 期待审）` : "审核"}
              title={pendingCount > 0 ? `${pendingCount} 期待审` : "审核"}
            >
              {pendingCount > 0 ? `审核·${pendingCount}` : "审核"}
            </Link>
          )}
          {/* 管理入口（spec07 2.3）：低调文字链，访客态点击展开口令输入条，管理员态点击退出管理 */}
          <button
            type="button"
            className="text-link text-xs shrink-0 mr-2"
            onClick={() => {
              if (admin) {
                clearAdminToken();
                setAdmin(false);
              } else {
                setGateOpen((v) => !v);
              }
            }}
            aria-label={admin ? "退出管理" : "管理"}
            title={admin ? "退出管理" : "管理"}
          >
            {admin ? "退出管理" : "管理"}
          </button>
          {/* 统一搜索（spec06 B3，全视图） */}
          <button
            onClick={() => setSearchOpen((v) => !v)}
            className="icon-btn"
            style={searchOpen ? { color: "var(--accent)" } : undefined}
            aria-label="搜索"
            aria-expanded={searchOpen}
            title="搜索"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>
          {/* 同步最近日报（spec06 B4，spec07 2.4 起仅管理员态渲染，访客 DOM 中不出现） */}
          {admin && (
            <button
              onClick={() => void runSync()}
              className="icon-btn"
              style={syncPhase === "fail" ? { color: "var(--accent)" } : undefined}
              aria-label="同步最近日报"
              title="同步最近日报"
              aria-busy={syncPhase === "running"}
            >
              <svg
                className={syncPhase === "running" ? "icon-spin" : undefined}
                width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
              >
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            </button>
          )}
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

      {/* 报头下方全宽搜索条（spec06 B3；spec11 契约 F 联想）：fade-up，Esc 收起，
          输入即联想下拉，Enter 跳选中条目或 /stream?query= */}
      {searchOpen && (
        <div className="px-5 pb-2.5 fade-up relative">
          <input
            autoFocus
            type="search"
            className="control-input"
            placeholder="搜索事件：标题 / 摘要 / 正文"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={onSearchKeyDown}
            onBlur={() => setSuggestOpen(false)}
            aria-label="搜索事件"
            aria-expanded={suggestOpen}
            role="combobox"
            aria-controls="search-suggest-list"
          />
          {suggestOpen && suggests.length > 0 && (
            <div
              id="search-suggest-list"
              role="listbox"
              className="absolute left-5 right-5 z-40"
              style={{
                top: "calc(100% - 6px)",
                background: "var(--bg)",
                border: "1px solid var(--rule)",
                borderRadius: "var(--radius-control)",
                boxShadow: "var(--shadow-overlay)",
                overflow: "hidden",
              }}
            >
              {suggests.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  role="option"
                  aria-selected={i === activeIdx}
                  onMouseDown={(e) => {
                    e.preventDefault(); // 抢在 blur 之前完成导航
                    gotoSuggestion(s);
                  }}
                  onMouseEnter={() => setActiveIdx(i)}
                  className="w-full text-left flex items-baseline gap-3 px-3 py-2"
                  style={{
                    background: i === activeIdx ? "var(--bg-warm)" : undefined,
                    borderTop: i > 0 ? "1px solid var(--rule)" : undefined,
                    cursor: "pointer",
                  }}
                >
                  <span className="min-w-0 flex-1 text-sm" style={{ lineHeight: 1.5 }}>
                    <HighlightText text={s.title} query={term} />
                    {s.snippet !== "" && (
                      <span className="block text-xs" style={{ color: "var(--fg-muted)" }}>
                        <HighlightText text={s.snippet} query={term} />
                      </span>
                    )}
                  </span>
                  <span
                    className="shrink-0 text-xs"
                    style={{ color: "var(--fg-muted)", fontVariantNumeric: "tabular-nums" }}
                  >
                    {s.date.slice(5)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 管理口令输入条（spec07 2.3）：AdminGate 探针验证通过后升级管理员态并收起；Esc 收起 */}
      {gateOpen && (
        <AdminGate
          onVerified={() => {
            setAdmin(true);
            setGateOpen(false);
          }}
          onClose={() => setGateOpen(false)}
        />
      )}

      {/* 同步状态细线小条（spec06 B4）：成功约 5s 自散；失败一行错误 + 重试文字链；403 提示需要管理口令 */}
      {syncPhase === "ok" && (
        <div
          className="rule-t px-5 py-1.5 text-xs flex items-center gap-2 fade-up"
          style={{ color: "var(--fg-muted)", fontVariantNumeric: "tabular-nums" }}
          role="status"
        >
          <span aria-hidden style={{ color: "var(--accent)" }}>●</span>
          {syncMsg}
        </div>
      )}
      {syncPhase === "fail" && (
        <div className="rule-t px-5 py-1.5 text-xs flex items-center gap-2 fade-up" style={{ color: "var(--fg-muted)" }} role="status">
          <span>{syncMsg}</span>
          <button type="button" className="text-link" onClick={() => void runSync()}>
            重试
          </button>
        </div>
      )}

      {isDaily && <div className="reading-progress" style={{ transform: `scaleX(${progress})` }} />}
    </header>
  );
}

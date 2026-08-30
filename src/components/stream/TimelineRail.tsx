"use client";

import { useEffect, useState, RefObject } from "react";
import { scrollToId } from "../ArticleView";

interface Mark {
  seq: number;
  title: string;
}

/** 阅读页左侧刻度时间线（spec11 §4.10，ZCode 会话时间线同款语言）：
 *  当期每个条目一枚短横刻度，hover 左向浮层显标题，点击 scrollToId 落位；
 *  scrollspy 高亮当前可视条目（accent 色 + 加长）。锚点 = h2[id^='article-']（ArticleH2），
 *  组件自省 DOM 拿条目清单（无需上层传数据）；仅 lg+ 视口渲染（窄屏与内容列重叠，CSS 隐藏）。 */
export function TimelineRail({
  mainRef,
  dataKey,
}: {
  mainRef: RefObject<HTMLElement | null>;
  /** 期标识（issueId/日期）：变更后重扫条目锚点 */
  dataKey: string;
}) {
  const [marks, setMarks] = useState<Mark[]>([]);
  const [activeSeq, setActiveSeq] = useState<number | null>(null);

  // 条目清单扫描：挂载与期切换后各扫一次（markdown 渲染可能有延迟，600ms 补扫兜底）
  useEffect(() => {
    const container = mainRef.current;
    if (!container) return;
    const scan = () => {
      const list = Array.from(
        container.querySelectorAll<HTMLElement>("h2[id^='article-']")
      )
        .map((h) => {
          const seq = Number(h.id.slice("article-".length));
          const title = (h.textContent || "").replace(/^#\d+\s*/, "").trim();
          return { seq, title: title.slice(0, 24) || `#${h.id.slice(8)}` };
        })
        .filter((m) => Number.isFinite(m.seq))
        .sort((a, b) => a.seq - b.seq);
      setMarks((prev) =>
        prev.length === list.length && prev.every((p, i) => p.seq === list[i]?.seq && p.title === list[i]?.title)
          ? prev
          : list
      );
    };
    scan();
    const t = setTimeout(scan, 600);
    return () => clearTimeout(t);
  }, [mainRef, dataKey]);

  // scrollspy（rAF 节流）：视口 40% 线以上最靠近的条目 = 当前条目
  useEffect(() => {
    const container = mainRef.current;
    if (!container) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const cRect = container.getBoundingClientRect();
        const line = cRect.top + cRect.height * 0.4;
        let current: number | null = null;
        for (const h of container.querySelectorAll<HTMLElement>("h2[id^='article-']")) {
          if (h.getBoundingClientRect().top <= line) {
            current = Number(h.id.slice("article-".length));
          }
        }
        setActiveSeq(current);
      });
    };
    onScroll();
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [mainRef, dataKey, marks.length]);

  if (marks.length === 0) return null;

  return (
    <nav
      aria-label="本期条目时间线"
      className="hidden lg:flex fixed left-3 top-1/2 -translate-y-1/2 z-30 flex-col justify-between"
      style={{ height: "min(420px, 60vh)" }}
    >
      {marks.map((m) => {
        const active = m.seq === activeSeq;
        return (
          <button
            key={m.seq}
            type="button"
            className="has-tip-left relative flex items-center"
            style={{
              height: 14,
              width: 20,
              padding: 0,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              justifyContent: "flex-start",
              opacity: active ? 1 : 0.35,
            }}
            data-tip={`#${m.seq} ${m.title}`}
            aria-label={`跳转条目 #${m.seq} ${m.title}`}
            aria-current={active ? "true" : undefined}
            onClick={() => scrollToId(`article-${m.seq}`, mainRef.current)}
          >
            <span
              aria-hidden
              style={{
                display: "block",
                height: 2,
                width: active ? 18 : 12,
                borderRadius: 1,
                background: active ? "var(--accent)" : "var(--fg-muted)",
                transition: "width 150ms var(--ease-out), background 150ms var(--ease-out)",
              }}
            />
          </button>
        );
      })}
    </nav>
  );
}

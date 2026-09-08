"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Header } from "../Header";
import { EmptyState } from "../common/EmptyState";
import { ItemCard } from "./ItemCard";
import { FacetRail, Facets, EMPTY_FACETS } from "./FacetRail";
import { apiFetch, ApiError, CompanyIndexEntry, ItemsPage, StreamItem, itemsQueryString } from "@/lib/api";

const PAGE_SIZE = 7; // 每页期数（API 默认 7，上限 31）

type LoadStatus = "loading" | "ready" | "empty" | "error";

interface DayGroup {
  date: string;
  items: StreamItem[];
}

function readFacetsFromUrl(): Facets {
  const p = new URLSearchParams(window.location.search);
  return {
    company: p.get("company") || "",
    category: p.get("category") || "",
    query: p.get("query") || "",
    from: p.get("from") || "",
    to: p.get("to") || "",
  };
}

function facetsToSearchParams(f: Facets): URLSearchParams {
  const p = new URLSearchParams();
  if (f.company) p.set("company", f.company);
  if (f.category) p.set("category", f.category);
  if (f.query) p.set("query", f.query);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  return p;
}

function groupByDay(items: StreamItem[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const it of items) {
    const last = groups[groups.length - 1];
    if (last && last.date === it.date) last.items.push(it);
    else groups.push({ date: it.date, items: [it] });
  }
  return groups;
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function dayLabel(date: string): string {
  const d = new Date(date + "T00:00:00");
  return `${date} 周${WEEKDAYS[d.getDay()]}`;
}

/** 骨架：.galley 结构同构块 + ink-sweep + 竖排「排版中」（FRONTEND_DESIGN §4.5） */
function StreamSkeleton() {
  return (
    <div className="relative pb-10" aria-busy="true">
      {[0, 1, 2].map((g) => (
        <div key={g}>
          <div className="day-head">
            <div className="galley h-3 w-36" />
          </div>
          <div>
            {[0, 1, 2].map((i) => (
              <div key={i} className="item-skel">
                <div className="galley w-7 h-4 justify-self-end mt-0.5" />
                <div className="flex flex-col gap-2.5 py-0.5">
                  <div className="galley h-4" style={{ width: `${74 - ((g + i) % 3) * 9}%` }} />
                  <div className="galley h-3" style={{ width: `${90 - ((g + i) % 2) * 18}%` }} />
                  <div className="galley h-3" style={{ width: "44%" }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      <span className="v-label absolute left-0 bottom-2" aria-hidden>
        排版中 …
      </span>
    </div>
  );
}

/** 事件流视图（FRONTEND_DESIGN §4.2/§4.3/§4.5/§4.6；ADR-0004/0012） */
export function StreamView() {
  const [facets, setFacets] = useState<Facets>(EMPTY_FACETS);
  const [items, setItems] = useState<StreamItem[]>([]);
  const [nextBeforeDate, setNextBeforeDate] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [errMsg, setErrMsg] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState("");
  const [companies, setCompanies] = useState<CompanyIndexEntry[]>([]);
  const [companiesError, setCompaniesError] = useState(false);
  // 手机端筛选面板（<640px 左栏隐藏，改为底部抽屉）：桌面恒 false，不影响既有版式
  const [filtersOpen, setFiltersOpen] = useState(false);

  // 请求序号：facet 变更与滚动翻页竞争时丢弃过期响应
  const reqSeq = useRef(0);

  const loadFirst = useCallback((f: Facets) => {
    const seq = ++reqSeq.current;
    setFacets(f); // 首屏从 URL 起facet 也回写状态（spec11：高亮与筛选 chip 依赖 facets.query）
    setStatus("loading");
    setErrMsg("");
    setMoreError("");
    apiFetch<ItemsPage>(`/api/items?${itemsQueryString({ ...f, limit: PAGE_SIZE })}`)
      .then((page) => {
        if (seq !== reqSeq.current) return;
        setItems(page.items);
        setNextBeforeDate(page.nextBeforeDate);
        setStatus(page.items.length === 0 ? "empty" : "ready");
      })
      .catch((e: unknown) => {
        if (seq !== reqSeq.current) return;
        setStatus("error");
        setErrMsg(e instanceof ApiError ? e.message : "网络异常，请稍后重试");
      });
  }, []);

  /** facet 变更：写 URL（pushState，ADR-0012）+ 清空重载；before_date 不进 URL */
  const applyFacets = useCallback(
    (next: Facets, updateUrl: boolean) => {
      setFacets(next);
      if (updateUrl) {
        const qs = facetsToSearchParams(next).toString();
        window.history.pushState(
          { facets: next },
          "",
          qs ? `${window.location.pathname}?${qs}` : window.location.pathname
        );
      }
      loadFirst(next);
    },
    [loadFirst]
  );

  // 首屏：读 URL query 决定初始 facet（不重写 URL）
  useEffect(() => {
    loadFirst(readFacetsFromUrl());
  }, [loadFirst]);

  // 公司 facet 数据 = /api/companies
  const loadCompanies = useCallback(() => {
    setCompaniesError(false);
    apiFetch<{ companies: CompanyIndexEntry[] }>("/api/companies")
      .then((r) => setCompanies(r.companies))
      .catch(() => setCompaniesError(true));
  }, []);
  useEffect(() => {
    loadCompanies();
  }, [loadCompanies]);

  // 浏览器前进/后退：按地址栏 query 还原 facet 并重载（复用 DailyPage popstate 范式）
  useEffect(() => {
    const onPop = () => {
      applyFacets(readFacetsFromUrl(), false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [applyFacets]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !nextBeforeDate || status !== "ready") return;
    const seq = reqSeq.current;
    setLoadingMore(true);
    setMoreError("");
    try {
      const page = await apiFetch<ItemsPage>(
        `/api/items?${itemsQueryString({ ...facets, beforeDate: nextBeforeDate, limit: PAGE_SIZE })}`
      );
      if (seq !== reqSeq.current) return;
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.id));
        return [...prev, ...page.items.filter((i) => !seen.has(i.id))];
      });
      setNextBeforeDate(page.nextBeforeDate);
    } catch (e: unknown) {
      if (seq !== reqSeq.current) return;
      setMoreError(e instanceof ApiError ? e.message : "网络异常，请稍后重试");
    } finally {
      if (seq === reqSeq.current) setLoadingMore(false);
    }
  }, [facets, loadingMore, nextBeforeDate, status]);

  // 滚动到底自动翻页（IntersectionObserver + scroll 兜底）
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { rootMargin: "600px 0px" }
    );
    io.observe(el);
    // 兜底：iOS Safari 下 html/body 若成滚动容器，root=null 的 IO 不触发（视口不动）；
    // scroll 不冒泡但捕获阶段可达，用哨兵视口坐标判定，两种滚动容器下都成立
    const onScroll = () => {
      if (el.getBoundingClientRect().top <= window.innerHeight + 600) void loadMore();
    };
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, [loadMore]);

  const groups = useMemo(() => groupByDay(items), [items]);
  const companyNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of companies) m.set(c.id, c.name);
    return m;
  }, [companies]);

  const activeChips = useMemo(() => {
    const chips: { key: keyof Facets; label: string }[] = [];
    if (facets.company)
      chips.push({ key: "company", label: companyNameById.get(facets.company) || facets.company });
    if (facets.category) chips.push({ key: "category", label: facets.category });
    if (facets.query) chips.push({ key: "query", label: `「${facets.query}」` });
    if (facets.from || facets.to)
      chips.push({ key: "from", label: `${facets.from || "…"} ~ ${facets.to || "今"}` });
    return chips;
  }, [facets, companyNameById]);

  const clearFacet = (key: keyof Facets) => {
    const next: Facets =
      key === "from" ? { ...facets, from: "", to: "" } : { ...facets, [key]: "" };
    applyFacets(next, true);
  };

  const clearAll = () => applyFacets(EMPTY_FACETS, true);

  /** 抽屉内筛选：选中公司/分类即收起（单值动作），日期输入保持展开 */
  const onSheetChange = (patch: Partial<Facets>) => {
    applyFacets({ ...facets, ...patch }, true);
    if (!("from" in patch) && !("to" in patch)) setFiltersOpen(false);
  };

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: "var(--bg)" }}>
      {/* 报头搜索词并入 facet 双向同步（spec06 B3）：覆盖式写 query，保留既有 facet，进 URL 可分享 */}
      <Header active="stream" onSearch={(term) => applyFacets({ ...facets, query: term }, true)} />

      <div className={`w-full max-w-6xl mx-auto px-5 flex flex-wrap items-center gap-2${activeChips.length > 0 ? " pt-4" : " pt-3 sm:pt-0"}`}>
        {/* 手机端筛选入口（桌面左栏常驻，此按钮 sm+ 隐藏） */}
        <button
          type="button"
          className="facet-chip only-mobile"
          onClick={() => setFiltersOpen(true)}
          aria-expanded={filtersOpen}
          aria-controls="stream-filter-sheet"
          style={{ cursor: "pointer" }}
        >
          筛选{activeChips.length > 0 ? ` · ${activeChips.length}` : ""}
        </button>
        {activeChips.map((chip) => (
          <span key={chip.key} className="facet-chip">
            {chip.label}
            <button type="button" className="facet-chip-x" onClick={() => clearFacet(chip.key)} aria-label={`清除筛选 ${chip.label}`}>
              ×
            </button>
          </span>
        ))}
        {activeChips.length > 0 && (
          <button type="button" className="text-link text-xs ml-1" onClick={clearAll}>
            清除全部
          </button>
        )}
      </div>

      <div className="stream-layout flex-1 w-full">
        <aside className="stream-rail hidden sm:block">
          <FacetRail
            facets={facets}
            companies={companies}
            companiesError={companiesError}
            onCompaniesRetry={loadCompanies}
            onChange={(patch) => applyFacets({ ...facets, ...patch }, true)}
          />
        </aside>

        <main className="py-6 min-w-0">
          {status === "loading" ? (
            <StreamSkeleton />
          ) : status === "error" ? (
            <EmptyState phrase="暂不可得" description={errMsg || "加载失败，请稍后重试。"} actionLabel="重新加载" onAction={() => loadFirst(facets)} />
          ) : status === "empty" ? (
            <EmptyState
              phrase="未有所获"
              description={
                facets.query
                  ? `没有匹配「${facets.query}」的条目，换个关键词或放宽筛选试试。`
                  : activeChips.length > 0
                    ? "所选切面下没有条目，试试放宽筛选或换一个时间范围。"
                    : "最近还没有条目入库，稍后再来看看。"
              }
              actionLabel={activeChips.length > 0 ? "清除筛选" : undefined}
              onAction={activeChips.length > 0 ? clearAll : undefined}
            />
          ) : (
            <div className="fade-up">
              <div className="item-list">
                {(() => {
                  let running = 0; // 首屏 ≤12 项 stagger 的全局序号
                  return groups.map((g) => {
                    const base = running;
                    running += g.items.length;
                    return (
                      <section key={g.date}>
                        <div className="day-head">
                          <span className="text-sm font-semibold" style={{ color: "var(--fg)", fontVariantNumeric: "tabular-nums" }}>
                            {dayLabel(g.date)}
                          </span>
                          <span className="h-px flex-1" style={{ background: "var(--rule)" }} aria-hidden />
                          <span className="facet-count">{g.items.length} 条</span>
                        </div>
                        {g.items.map((it, i) => (
                          <ItemCard key={it.id} item={it} index={base + i} highlightQuery={facets.query} />
                        ))}
                      </section>
                    );
                  });
                })()}
              </div>

              {/* 翻页区：滚动加载 / 失败重试 / 到底标记 */}
              {loadingMore && (
                <div aria-busy="true">
                  {[0, 1].map((i) => (
                    <div key={i} className="item-skel">
                      <div className="galley w-7 h-4 justify-self-end mt-0.5" />
                      <div className="flex flex-col gap-2.5 py-0.5">
                        <div className="galley h-4" style={{ width: `${76 - i * 12}%` }} />
                        <div className="galley h-3" style={{ width: "52%" }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {moreError && (
                <div className="py-6 text-sm flex items-center gap-3" style={{ color: "var(--fg-muted)" }}>
                  <span>{moreError}</span>
                  <button type="button" className="text-link" onClick={() => void loadMore()}>
                    重试
                  </button>
                </div>
              )}
              <div ref={sentinelRef} className="h-px" aria-hidden />
              {!loadingMore && !nextBeforeDate && items.length > 0 && !moreError && (
                <div className="py-8 text-center text-xs" style={{ color: "var(--fg-muted)", letterSpacing: "0.2em" }}>
                  — 已到底 · 共 {items.length} 条 —
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* 手机端筛选抽屉（<640px）：底部面板自带滚动，遮罩点击收起；桌面不渲染 */}
      {filtersOpen && (
        <div className="fixed inset-0 z-40 sm:hidden" role="dialog" aria-modal="true" aria-label="筛选" id="stream-filter-sheet">
          <button
            type="button"
            className="absolute inset-0 overlay-backdrop"
            style={{ background: "color-mix(in srgb, var(--fg) 32%, transparent)", border: "none", padding: 0, cursor: "pointer" }}
            onClick={() => setFiltersOpen(false)}
            aria-label="关闭筛选"
          />
          <div
            className="absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto overlay-panel"
            style={{ background: "var(--bg)", padding: "12px 20px 20px" }}
          >
            <div className="flex items-center justify-between pb-1">
              <span className="text-sm font-semibold" style={{ color: "var(--fg)" }}>
                筛选
              </span>
              <button type="button" className="text-link text-xs" onClick={() => setFiltersOpen(false)}>
                完成
              </button>
            </div>
            <FacetRail
              facets={facets}
              companies={companies}
              companiesError={companiesError}
              onCompaniesRetry={loadCompanies}
              onChange={onSheetChange}
            />
          </div>
        </div>
      )}
    </div>
  );
}

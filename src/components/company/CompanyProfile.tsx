"use client";

import { useCallback, useEffect, useMemo, useRef, useState, CSSProperties } from "react";
import Link from "next/link";
import { Header } from "../Header";
import { EmptyState } from "../common/EmptyState";
import { ItemCard } from "../stream/ItemCard";
import { apiFetch, ApiError, CompanyProfileResponse, ItemsPage, StreamItem, itemsQueryString } from "@/lib/api";

const PAGE_SIZE = 7;

type ProfileStatus = "loading" | "ready" | "error" | "notfound";
type ItemsStatus = "loading" | "ready" | "empty" | "error";

function sealStyle(color: string, size: number, fontSize: number): CSSProperties {
  return { "--seal": color, width: size, height: size, fontSize } as CSSProperties;
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="stat-label">{label}</div>
      <div className="stat-num mt-1.5 truncate" title={typeof value === "string" ? value : undefined}>
        {value}
      </div>
      {sub && (
        <div className="text-xs mt-1 truncate" style={{ color: "var(--fg-muted)", fontVariantNumeric: "tabular-nums" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

/** 骨架：档案头五块同构轮廓 + 条目块（.galley + ink-sweep） */
function ProfileSkeleton() {
  return (
    <div className="relative pb-12" aria-busy="true">
      <div className="flex items-start gap-4">
        <div className="galley shrink-0" style={{ width: 52, height: 52, borderRadius: 2 }} />
        <div className="flex-1 flex flex-col gap-2.5 pt-1">
          <div className="galley h-7 w-52" />
          <div className="galley h-3 w-72 max-w-full" />
          <div className="galley h-2.5 w-40" />
        </div>
      </div>
      <div className="rule-t mt-7 pt-6 grid grid-cols-2 md:grid-cols-4 gap-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <div className="galley h-2.5 w-14" />
            <div className="galley h-5" style={{ width: `${70 - i * 8}%` }} />
          </div>
        ))}
      </div>
      <div className="rule-t mt-7 pt-6 flex flex-col gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <div className="galley h-2.5 w-16 shrink-0" />
            <div className="galley h-1.5 flex-1" style={{ width: `${80 - i * 15}%` }} />
          </div>
        ))}
      </div>
      <div className="rule-t mt-7 pt-6 flex gap-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="galley shrink-0" style={{ width: 20, height: 20, borderRadius: 2 }} />
        ))}
      </div>
      <div className="mt-10">
        <div className="item-list">
          {[0, 1, 2].map((i) => (
            <div key={i} className="item-skel">
              <div className="galley w-7 h-4 justify-self-end mt-0.5" />
              <div className="flex flex-col gap-2.5 py-0.5">
                <div className="galley h-4" style={{ width: `${76 - i * 10}%` }} />
                <div className="galley h-3" style={{ width: "50%" }} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <span className="v-label absolute left-0 bottom-2" aria-hidden>
        排版中 …
      </span>
    </div>
  );
}

/** 公司档案页（ADR-0007 五块 + 复用 /api/items 卡片流；FRONTEND_DESIGN §4.2 差异渲染） */
export function CompanyProfile({ id }: { id: string }) {
  const [profile, setProfile] = useState<CompanyProfileResponse | null>(null);
  const [status, setStatus] = useState<ProfileStatus>("loading");
  const [errMsg, setErrMsg] = useState("");

  const [items, setItems] = useState<StreamItem[]>([]);
  const [nextBeforeDate, setNextBeforeDate] = useState<string | null>(null);
  const [itemsStatus, setItemsStatus] = useState<ItemsStatus>("loading");
  const [itemsErrMsg, setItemsErrMsg] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState("");
  const reqSeq = useRef(0);

  const loadProfile = useCallback(() => {
    setStatus("loading");
    setErrMsg("");
    apiFetch<CompanyProfileResponse>(`/api/companies/${encodeURIComponent(id)}`)
      .then((r) => {
        setProfile(r);
        setStatus("ready");
      })
      .catch((e: unknown) => {
        const err = e instanceof ApiError ? e : new ApiError("unknown", 0, "网络异常，请稍后重试");
        setStatus(err.status === 404 || err.code === "company_not_found" ? "notfound" : "error");
        setErrMsg(err.message);
      });
  }, [id]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const loadItems = useCallback(() => {
    const seq = ++reqSeq.current;
    setItemsStatus("loading");
    setItemsErrMsg("");
    setMoreError("");
    apiFetch<ItemsPage>(`/api/items?${itemsQueryString({ company: id, limit: PAGE_SIZE })}`)
      .then((page) => {
        if (seq !== reqSeq.current) return;
        setItems(page.items);
        setNextBeforeDate(page.nextBeforeDate);
        setItemsStatus(page.items.length === 0 ? "empty" : "ready");
      })
      .catch((e: unknown) => {
        if (seq !== reqSeq.current) return;
        setItemsStatus("error");
        setItemsErrMsg(e instanceof ApiError ? e.message : "网络异常，请稍后重试");
      });
  }, [id]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !nextBeforeDate || itemsStatus !== "ready") return;
    const seq = reqSeq.current;
    setLoadingMore(true);
    setMoreError("");
    try {
      const page = await apiFetch<ItemsPage>(
        `/api/items?${itemsQueryString({ company: id, beforeDate: nextBeforeDate, limit: PAGE_SIZE })}`
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
  }, [id, itemsStatus, loadingMore, nextBeforeDate]);

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
    return () => io.disconnect();
  }, [loadMore]);

  const distRows = useMemo(() => {
    if (!profile) return [] as [string, number][];
    return Object.entries(profile.stats.categoryDistribution)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1]);
  }, [profile]);
  const distMax = distRows.length > 0 ? distRows[0][1] : 0;

  // 条形入场：挂载后从 0 展开（精密反馈，500ms --ease-out）
  const [barsGrown, setBarsGrown] = useState(false);
  useEffect(() => {
    if (distRows.length === 0) return;
    const raf = requestAnimationFrame(() => setBarsGrown(true));
    return () => cancelAnimationFrame(raf);
  }, [distRows.length]);

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: "var(--bg)" }}>
      <Header active="company" />

      <main className="w-full max-w-3xl mx-auto px-5 py-8 flex-1">
        {status === "loading" ? (
          <ProfileSkeleton />
        ) : status === "notfound" ? (
          <EmptyState
            phrase="查无此家"
            description={`公司索引中没有「${id}」。id 可在 /company 页的公司墙上找到。`}
            href="/company"
            actionLabel="返回公司索引"
          />
        ) : status === "error" ? (
          <EmptyState phrase="暂不可得" description={errMsg || "档案加载失败。"} actionLabel="重新加载" onAction={loadProfile} />
        ) : profile ? (
          <div className="fade-up">
            {/* ── 档案头五块（ADR-0007） ── */}
            <header>
              {/* 块 1 · 基础：印 + 名 + notes + aliases */}
              <div className="flex items-start gap-4">
                <span className="seal shrink-0" style={sealStyle(profile.company.color, 52, 26)} aria-hidden>
                  {profile.company.name.charAt(0)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h1 className="hero-title text-3xl font-bold leading-tight">{profile.company.name}</h1>
                    {profile.company.status !== "active" && (
                      <span className="facet-chip" style={{ padding: "2px 8px" }}>
                        {profile.company.status === "dormant" ? "休刊中" : "已退役"}
                      </span>
                    )}
                  </div>
                  {profile.company.notes && (
                    <p className="mt-1.5 text-sm" style={{ color: "var(--fg-light)" }}>
                      {profile.company.notes}
                    </p>
                  )}
                  {profile.company.aliases.length > 0 && (
                    <p
                      className="mt-1.5 text-xs leading-relaxed"
                      style={{ color: "var(--fg-muted)", fontFamily: "var(--font-mono)" }}
                    >
                      又名 {profile.company.aliases.join(" · ")}
                    </p>
                  )}
                </div>
              </div>

              {/* 块 2 · 事件统计 + 块 5 · 时间跨度 */}
              <div className="rule-t mt-7 pt-6 grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-5">
                <Stat label="条目总数" value={profile.stats.total} />
                <Stat label="近 30 天" value={profile.stats.last30d} />
                <Stat label="最近事件" value={profile.stats.lastEventDate || "—"} />
                <Stat
                  label="时间跨度"
                  value={profile.stats.timeSpan?.earliest || "—"}
                  sub={profile.stats.timeSpan?.latest ? `至 ${profile.stats.timeSpan.latest}` : undefined}
                />
              </div>

              {/* 块 3 · 分类分布（div 宽度条，无图表库） */}
              <div className="rule-t mt-7 pt-6">
                <h2 className="stat-label">分类分布</h2>
                {distRows.length === 0 ? (
                  <p className="mt-3 text-xs" style={{ color: "var(--fg-muted)" }}>
                    暂无分类数据
                  </p>
                ) : (
                  <div className="mt-3.5 flex flex-col gap-3">
                    {distRows.map(([cat, n]) => (
                      <div key={cat} className="dist-row">
                        <span className="text-xs truncate" style={{ color: "var(--fg-light)" }} title={cat}>
                          {cat}
                        </span>
                        <div className="dist-track">
                          <div
                            className="dist-bar"
                            style={{ width: barsGrown && distMax > 0 ? `${((n / distMax) * 100).toFixed(1)}%` : "0%" }}
                          />
                        </div>
                        <span className="facet-count" style={{ marginLeft: 0 }}>
                          {n}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 块 4 · 关联公司（≤8 钤印可点，按共同出现次数倒序） */}
              <div className="rule-t mt-7 pt-6">
                <h2 className="stat-label">关联公司</h2>
                {profile.stats.coworkers.length === 0 ? (
                  <p className="mt-3 text-xs" style={{ color: "var(--fg-muted)" }}>
                    暂无同条目出现的其他公司
                  </p>
                ) : (
                  <div className="mt-3.5 flex flex-wrap gap-x-5 gap-y-2.5">
                    {profile.stats.coworkers.map((cw) => (
                      <Link key={cw.companyId} href={`/company/${cw.companyId}`} className="flex items-center gap-2 no-underline">
                        <span className="seal" style={sealStyle(cw.color, 20, 11)} data-tip={`${cw.name} · 同条目 ${cw.count} 次`} aria-hidden>
                          {cw.name.charAt(0)}
                        </span>
                        <span className="text-xs" style={{ color: "var(--fg-light)" }}>
                          {cw.name}
                        </span>
                        <span className="text-xs" style={{ color: "var(--fg-muted)", fontVariantNumeric: "tabular-nums" }}>
                          {cw.count}
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </header>

            {/* ── 该公司条目（复用 /api/items + ItemCard variant="company"） ── */}
            <section className="mt-10">
              <div className="day-head" style={{ paddingTop: 0 }}>
                <h2 className="text-sm font-semibold" style={{ color: "var(--fg)" }}>
                  条目
                </h2>
                <span className="h-px flex-1" style={{ background: "var(--rule)" }} aria-hidden />
                <span className="facet-count">{profile.stats.total} 条</span>
              </div>

              {itemsStatus === "loading" ? (
                <div className="item-list" aria-busy="true">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="item-skel">
                      <div className="galley w-7 h-4 justify-self-end mt-0.5" />
                      <div className="flex flex-col gap-2.5 py-0.5">
                        <div className="galley h-4" style={{ width: `${78 - i * 11}%` }} />
                        <div className="galley h-3" style={{ width: "52%" }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : itemsStatus === "error" ? (
                <EmptyState phrase="暂不可得" description={itemsErrMsg || "条目加载失败。"} actionLabel="重新加载" onAction={loadItems} />
              ) : itemsStatus === "empty" ? (
                <EmptyState phrase="未有所获" description="该公司名下暂无条目。" />
              ) : (
                <>
                  <div className="item-list">
                    {items.map((it, i) => (
                      <ItemCard key={it.id} item={it} variant="company" profileCompanyId={id} index={i} />
                    ))}
                  </div>
                  {loadingMore && (
                    <div aria-busy="true">
                      {[0, 1].map((i) => (
                        <div key={i} className="item-skel">
                          <div className="galley w-7 h-4 justify-self-end mt-0.5" />
                          <div className="flex flex-col gap-2.5 py-0.5">
                            <div className="galley h-4" style={{ width: `${74 - i * 12}%` }} />
                            <div className="galley h-3" style={{ width: "48%" }} />
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
                </>
              )}
            </section>
          </div>
        ) : null}
      </main>
    </div>
  );
}

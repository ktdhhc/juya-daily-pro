"use client";

import { useCallback, useEffect, useMemo, useState, CSSProperties } from "react";
import Link from "next/link";
import { Header } from "../Header";
import { EmptyState } from "../common/EmptyState";
import { apiFetch, ApiError, CompanyIndexEntry } from "@/lib/api";

const STATUS_MARK: Record<string, string> = { dormant: "休", retired: "退" };

function sealStyle(color: string, size: number, fontSize: number): CSSProperties {
  return { "--seal": color, width: size, height: size, fontSize } as CSSProperties;
}

function IndexSkeleton() {
  return (
    <div className="seal-wall" aria-busy="true">
      {[...Array(12)].map((_, i) => (
        <div key={i} className="seal-cell" style={{ cursor: "default" }}>
          <div className="flex items-center gap-3">
            <div className="galley shrink-0" style={{ width: 30, height: 30, borderRadius: 2 }} />
            <div className="flex-1 min-w-0 flex flex-col gap-1.5">
              <div className="galley h-3.5" style={{ width: `${72 - (i % 3) * 10}%` }} />
              <div className="galley h-2.5 w-10" />
            </div>
          </div>
          <div className="galley h-2.5" style={{ width: `${88 - (i % 4) * 8}%` }} />
        </div>
      ))}
    </div>
  );
}

/** 公司索引（FRONTEND_DESIGN §2「印」）：印章卡片墙，细线分格，按条目数倒序 + 客户端检索 */
export function CompanyIndex() {
  const [companies, setCompanies] = useState<CompanyIndexEntry[] | null>(null); // null = 加载中
  const [error, setError] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [query, setQuery] = useState("");

  const load = useCallback(() => {
    setError(false);
    setErrMsg("");
    apiFetch<{ companies: CompanyIndexEntry[] }>("/api/companies")
      .then((r) => setCompanies(r.companies))
      .catch((e: unknown) => {
        setError(true);
        setErrMsg(e instanceof ApiError ? e.message : "网络异常，请稍后重试");
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // API 已按 total 倒序；客户端再保证一次，检索在前端做
  const filtered = useMemo(() => {
    if (!companies) return [];
    const q = query.trim().toLowerCase();
    const list = q
      ? companies.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.id.toLowerCase().includes(q) ||
            c.aliases.some((a) => a.toLowerCase().includes(q))
        )
      : companies;
    return [...list].sort((a, b) => b.stats.total - a.stats.total);
  }, [companies, query]);

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: "var(--bg)" }}>
      <Header active="company" />

      <main className="w-full max-w-5xl mx-auto px-5 py-8 flex-1">
        {/* 页眉：题名 + 检索 */}
        <header className="fade-up flex flex-wrap items-end gap-x-8 gap-y-4 mb-6">
          <div>
            <h1 className="hero-title text-3xl font-bold leading-tight">公司索引</h1>
            <p className="mt-1 text-xs" style={{ color: "var(--fg-muted)", fontVariantNumeric: "tabular-nums" }}>
              {companies ? `${companies.length} 家 · 按条目数排序` : "载入中 …"}
            </p>
          </div>
          <div className="w-full sm:w-64 sm:ml-auto">
            <input
              type="search"
              className="control-input"
              placeholder="检索公司名 / 别名 / id"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="检索公司"
            />
          </div>
        </header>

        {companies === null && !error ? (
          <IndexSkeleton />
        ) : error ? (
          <EmptyState phrase="暂不可得" description={errMsg || "公司索引加载失败。"} actionLabel="重新加载" onAction={load} />
        ) : filtered.length === 0 ? (
          <EmptyState phrase="未有所获" description={`没有匹配「${query.trim()}」的公司，换个说法试试。`} actionLabel="清空检索" onAction={() => setQuery("")} />
        ) : (
          <div className="seal-wall fade-up">
            {filtered.map((c) => (
              <Link key={c.id} href={`/company/${c.id}`} className="seal-cell">
                <div className="flex items-center gap-3">
                  <span className="seal" style={sealStyle(c.color, 30, 16)} aria-hidden>
                    {c.name.charAt(0)}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate" style={{ color: "var(--fg)" }}>
                      {c.name}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: "var(--fg-muted)", fontVariantNumeric: "tabular-nums" }}>
                      {c.stats.total} 条
                    </div>
                  </div>
                  {c.status !== "active" && (
                    <span
                      className="ml-auto shrink-0 inline-flex items-center justify-center text-xs"
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: "var(--radius-control)",
                        background: "var(--bg-warm)",
                        color: "var(--fg-muted)",
                      }}
                      title={c.status === "dormant" ? "休刊中" : "已退役"}
                    >
                      {STATUS_MARK[c.status] || "?"}
                    </span>
                  )}
                </div>
                {c.notes && (
                  <p className="text-xs leading-relaxed line-clamp-2" style={{ color: "var(--fg-muted)" }}>
                    {c.notes}
                  </p>
                )}
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

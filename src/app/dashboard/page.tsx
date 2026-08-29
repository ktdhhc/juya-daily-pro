"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Header } from "@/components/Header";
import { AdminGate } from "@/components/common/AdminGate";
import { EmptyState } from "@/components/common/EmptyState";
import { EnrichDonut } from "@/components/dashboard/EnrichDonut";
import { RankBars } from "@/components/dashboard/RankBars";
import { StatTiles } from "@/components/dashboard/StatTiles";
import { SyncHeatmap } from "@/components/dashboard/SyncHeatmap";
import { TrendLine } from "@/components/dashboard/TrendLine";
import { ApiError, StatsResponse, fetchStats } from "@/lib/api";
import { isAdmin } from "@/lib/auth";

type LoadStatus = "loading" | "ready" | "error";

/** 骨架：五段同构轮廓块（.galley + ink-sweep，FRONTEND_DESIGN §4.5） */
function DashboardSkeleton() {
  return (
    <div className="relative pb-10" aria-busy="true">
      <div className="rule-t mt-4 pt-6 grid grid-cols-2 md:grid-cols-5 gap-5">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <div className="galley h-2.5 w-14" />
            <div className="galley h-5" style={{ width: `${72 - i * 8}%` }} />
          </div>
        ))}
      </div>
      <div className="rule-t mt-7 pt-6 flex flex-col gap-3">
        <div className="galley h-2.5 w-24" />
        <div className="galley h-36" />
      </div>
      <div className="rule-t mt-7 pt-6 grid md:grid-cols-2 gap-7">
        <div className="flex flex-col gap-3">
          <div className="galley h-2.5 w-20" />
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <div className="galley h-2.5 w-16 shrink-0" />
              <div className="galley h-1.5 flex-1" style={{ width: `${80 - i * 12}%` }} />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-3">
          <div className="galley h-2.5 w-20" />
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <div className="galley h-2.5 w-16 shrink-0" />
              <div className="galley h-1.5 flex-1" style={{ width: `${72 - i * 10}%` }} />
            </div>
          ))}
        </div>
      </div>
      <div className="rule-t mt-7 pt-6 flex gap-3">
        <div className="galley shrink-0" style={{ width: 160, height: 160, borderRadius: "var(--radius-content)" }} />
      </div>
      <span className="v-label absolute left-0 bottom-2" aria-hidden>
        排版中 …
      </span>
    </div>
  );
}

/** 数据面板页（spec08）：单端点 GET /api/stats 一次拉全量，五段布局
 *  （总览五块 / 每日条目折线 / 墨条 ×2 / 归属环形 / 同步热力图）。
 *  访客 = §4.6 空态 + AdminGate 原地解锁（验证通过立即拉数据，无需跳转）；
 *  加载失败 = §4.6 错误态 + 重试文字链。 */
export default function DashboardPage() {
  // 管理员态：挂载后读一次 localStorage（静态导出首帧按访客渲染，避免水合错位——同 Header/Review 范式）
  const [admin, setAdmin] = useState(false);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [data, setData] = useState<StatsResponse | null>(null);
  const [errMsg, setErrMsg] = useState("");

  const loadStats = useCallback(() => {
    setStatus("loading");
    setErrMsg("");
    fetchStats()
      .then((payload) => {
        setData(payload);
        setStatus("ready");
      })
      .catch((e: unknown) => {
        setStatus("error");
        setErrMsg(
          e instanceof ApiError ? (e.code === "unauthorized" ? "需要管理口令" : e.message) : "网络异常，请稍后重试"
        );
      });
  }, []);

  useEffect(() => setAdmin(isAdmin()), []);

  useEffect(() => {
    if (!admin) return;
    loadStats();
  }, [admin, loadStats]);

  // 热力图「今天」：挂载时取一次（84 格网格对齐以当天为末列）
  const today = useMemo(() => new Date(), []);

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: "var(--bg)" }}>
      <Header active="dashboard" />

      {!admin ? (
        /* 访客：§4.6 空态 + AdminGate 原地解锁（spec08 模式，同 /review） */
        <main className="flex-1">
          <EmptyState phrase="非请莫入" description="此页为数据面板，访客不可见；输入管理口令后原地解锁。" />
          <div className="max-w-sm mx-auto pb-16">
            <AdminGate onVerified={() => setAdmin(true)} />
          </div>
        </main>
      ) : (
        <main className="flex-1 w-full max-w-6xl mx-auto px-5 py-4">
          {status === "loading" && <DashboardSkeleton />}
          {status === "error" && (
            <EmptyState phrase="暂不可得" description={errMsg || "加载失败。"} actionLabel="重新加载" onAction={loadStats} />
          )}
          {status === "ready" && data && (
            <>
              <h1 className="text-sm font-semibold pt-1" style={{ color: "var(--fg)" }}>
                数据面板
              </h1>

              {/* 段 1 · 总览五块 */}
              <section className="rule-t mt-4 pt-6">
                <h2 className="stat-label">总览</h2>
                <div className="mt-3.5">
                  <StatTiles overview={data.overview} />
                </div>
              </section>

              {/* 段 2 · 每日条目折线 */}
              <section className="rule-t mt-7 pt-6">
                <h2 className="stat-label">每日条目 · 近 90 天</h2>
                <div className="mt-3.5">
                  <TrendLine daily={data.daily} />
                </div>
              </section>

              {/* 段 3 · 墨条 ×2（分类全量 / 公司 Top12） */}
              <section className="rule-t mt-7 pt-6">
                <RankBars categories={data.categories} companies={data.companies} />
              </section>

              {/* 段 4 · 归属状态环形 */}
              <section className="rule-t mt-7 pt-6">
                <h2 className="stat-label">归属状态</h2>
                <div className="mt-3.5">
                  <EnrichDonut enrich={data.enrich} rate={data.overview.attributedRate} />
                </div>
              </section>

              {/* 段 5 · 同步热力图 */}
              <section className="rule-t mt-7 pt-6 pb-10">
                <h2 className="stat-label">同步记录 · 近 12 周</h2>
                <div className="mt-3.5">
                  <SyncHeatmap sync={data.sync} daily={data.daily} today={today} />
                </div>
              </section>
            </>
          )}
        </main>
      )}
    </div>
  );
}

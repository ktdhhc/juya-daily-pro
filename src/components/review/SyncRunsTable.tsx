"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, SyncRun, fetchSyncRuns } from "@/lib/api";

interface Props {
  /** 触发同步（POST /api/sync，page 传入既有 runSync）：失败行就地「重试」；运行中禁用（spec14 契约 E） */
  onRetry: () => void;
  /** 同步运行中：重试按钮互斥禁用 */
  syncing: boolean;
  /** 刷新信号（数字变化触发重拉，如同步完成后的自增计数）；undefined = 不监听 */
  refreshKey?: number;
}

function stamp(s: string | null): string {
  return s === null ? "—" : s.replace("T", " ").slice(5, 16);
}

/** 同步运行记录表（spec14 契约 E，替代 HistoryPanel 同步历史折叠区）：挂载即拉 GET /api/review/sync-runs(20)。
 *  每行 = 状态点标（ok 墨 / 失败朱橙）· 时间 · 窗口 N 期 · 新增/更新/未变化（0 省略）· 失败红字 · 耗时 s；
 *  失败行就地「重试」。不做分页、不做「较上次 diff」（运行记录自身已含三分类）。 */
export function SyncRunsTable({ onRetry, syncing, refreshKey }: Props) {
  const [phase, setPhase] = useState<"loading" | "ok" | "fail">("loading");
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [errMsg, setErrMsg] = useState("");

  const load = useCallback(() => {
    setPhase("loading");
    fetchSyncRuns(20)
      .then((r) => {
        setRuns(r.runs);
        setPhase("ok");
      })
      .catch((e: unknown) => {
        setPhase("fail");
        setErrMsg(
          e instanceof ApiError ? (e.code === "unauthorized" ? "需要管理口令" : e.message) : "网络异常，请稍后重试"
        );
      });
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  return (
    <section className="mt-10" aria-label="同步运行记录">
      <div className="day-head">
        <span className="text-sm font-semibold" style={{ color: "var(--fg)" }}>
          同步运行记录
        </span>
        <span className="h-px flex-1" style={{ background: "var(--rule)" }} aria-hidden />
        <span className="facet-count">{phase === "ok" ? `${runs.length} 次` : ""}</span>
      </div>

      {phase === "loading" && (
        <p className="rule-t py-2 text-xs" style={{ color: "var(--fg-muted)" }}>
          载入中…
        </p>
      )}
      {phase === "fail" && (
        <p className="rule-t py-2 text-xs flex items-center gap-2" style={{ color: "var(--fg-muted)" }} role="alert">
          <span>{errMsg}</span>
          <button type="button" className="text-link" onClick={load}>
            重试
          </button>
        </p>
      )}
      {phase === "ok" && runs.length === 0 && (
        <p className="rule-t py-2 text-xs" style={{ color: "var(--fg-muted)" }}>
          暂无运行记录——「同步最新」跑过一次后这里会留痕。
        </p>
      )}
      {phase === "ok" &&
        runs.map((run, i) => {
          const parts: string[] = [`窗口 ${run.windowDates.length} 期`];
          if (run.added.length > 0) parts.push(`新增 ${run.added.length}`);
          if (run.updated.length > 0) parts.push(`更新 ${run.updated.length}`);
          if (run.unchanged.length > 0) parts.push(`未变化 ${run.unchanged.length}`);
          if (run.failures.length > 0) parts.push(`失败 ${run.failures.length}`);
          const durationSec = run.durationMs === null ? null : run.durationMs / 1000;
          return (
            <div key={run.startedAt ?? `idx-${i}`} className="rule-t py-2 text-xs min-w-0">
              <div className="flex items-baseline gap-3 min-w-0" style={{ fontVariantNumeric: "tabular-nums" }}>
                {/* 状态点标：ok 墨点 / 失败朱橙（§4.9 点语言） */}
                <span
                  aria-hidden
                  className="shrink-0"
                  style={{ color: run.ok ? "var(--fg)" : "var(--accent)", fontSize: 9, lineHeight: 1 }}
                >
                  ●
                </span>
                <span className="shrink-0" style={{ color: "var(--fg)" }}>
                  {stamp(run.startedAt)}
                </span>
                <span className="min-w-0 truncate" style={{ color: run.ok ? "var(--fg-muted)" : "var(--accent)" }}>
                  {parts.slice(1).join(" · ")}
                </span>
                {durationSec !== null && durationSec >= 0.1 && (
                  <span className="shrink-0" style={{ color: "var(--fg-muted)" }}>
                    耗时 {durationSec.toFixed(1)}s
                  </span>
                )}
                {!run.ok && (
                  <button
                    type="button"
                    className="text-link shrink-0 ml-auto"
                    onClick={onRetry}
                    disabled={syncing}
                    aria-busy={syncing}
                    aria-label={`重试 ${stamp(run.startedAt)} 那次同步`}
                  >
                    {syncing ? "同步中…" : "重试"}
                  </button>
                )}
              </div>
              {/* 失败行内红字错误（首条 + 余下逐行，truncate + title 全文） */}
              {run.failures.length > 0 && (
                <ul className="mt-1 pl-4 min-w-0" style={{ color: "var(--accent)" }}>
                  {run.failures.map((f, j) => (
                    <li key={f.date + String(j)} className="truncate" title={f.error}>
                      {f.date} · {f.error}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
    </section>
  );
}

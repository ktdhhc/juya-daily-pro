"use client";

import { useMemo, useRef, useState } from "react";
import { ApiError, PendingDateGroup, PublishOutcome } from "@/lib/api";

interface Props {
  /** 待审期组（含条目，供入库预览统计）；父层 useMemo 供给，identity 稳定 */
  groups: PendingDateGroup[];
  /** 确认入库（POST /api/review/publish）；父层负责发布后重拉 pending，抛错 = 失败 */
  onPublish: (dates: string[]) => Promise<PublishOutcome>;
}

type Phase = "idle" | "running" | "ok" | "fail";

/** 底部固定发布条（spec10 票 03 + spec12 契约 D）：期勾选（默认全选）+ 勾选变化实时入库预览
 *  +「确认入库（M 条）」。成功细线小条约 5s 自散（复用 Header 同步反馈语言）；失败一行错误 + 重试。 */
export function PublishBar({ groups, onPublish }: Props) {
  // 默认全选 = 记「取消勾选集」而非勾选集：重拉后新出现的期自动勾上，已取消的保持不勾
  const [unchecked, setUnchecked] = useState<Set<string>>(() => new Set());
  const [phase, setPhase] = useState<Phase>("idle");
  const [msg, setMsg] = useState("");
  const runningRef = useRef(false);

  const dates = useMemo(() => groups.map((g) => g.date), [groups]);
  const selected = useMemo(() => dates.filter((d) => !unchecked.has(d)), [dates, unchecked]);

  // 入库预览统计（spec12 契约 D）：勾选期内条目的 proposal 有无（human-edit 亦算建议生效）
  const stats = useMemo(() => {
    let items = 0;
    let withProposal = 0;
    for (const g of groups) {
      if (unchecked.has(g.date)) continue;
      items += g.items.length;
      withProposal += g.items.filter((it) => it.proposal !== null).length;
    }
    return { items, withProposal, without: items - withProposal };
  }, [groups, unchecked]);

  const toggle = (d: string) => {
    setUnchecked((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  };

  const publish = async () => {
    if (runningRef.current || selected.length === 0) return;
    runningRef.current = true;
    setPhase("running");
    setMsg("");
    try {
      const res = await onPublish(selected);
      setMsg(`入库 ${res.publishedDates.length} 期 · ${res.itemsPublished} 条`);
      setPhase("ok");
      setTimeout(() => setPhase("idle"), 5000);
    } catch (e) {
      setMsg(
        e instanceof ApiError
          ? e.code === "unauthorized"
            ? "需要管理口令"
            : e.message
          : "网络异常，请稍后重试"
      );
      setPhase("fail");
    } finally {
      runningRef.current = false;
    }
  };

  const disabled = selected.length === 0 || phase === "running";

  return (
    <div
      className="sticky bottom-0 z-40"
      style={{
        background: "color-mix(in srgb, var(--bg) 90%, transparent)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        boxShadow: "0 -1px 0 var(--border)",
      }}
    >
      {/* 反馈细线小条（复用 Header 同步反馈语言）：成功 5s 自散；失败保留 + 重试 */}
      {phase === "ok" && (
        <div
          className="rule-t px-5 py-1.5 text-xs flex items-center gap-2 fade-up max-w-6xl mx-auto"
          style={{ color: "var(--fg-muted)", fontVariantNumeric: "tabular-nums" }}
          role="status"
        >
          <span aria-hidden style={{ color: "var(--accent)" }}>
            ●
          </span>
          {msg}
        </div>
      )}
      {phase === "fail" && (
        <div
          className="rule-t px-5 py-1.5 text-xs flex items-center gap-2 fade-up max-w-6xl mx-auto"
          style={{ color: "var(--fg-muted)" }}
          role="status"
        >
          <span>{msg}</span>
          <button type="button" className="text-link" onClick={() => void publish()}>
            重试
          </button>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-5 pt-1.5 pb-2.5">
        {/* 入库预览（spec12 契约 D）：勾选变化实时计算，数字 tabular */}
        <p className="text-xs" style={{ color: "var(--fg-muted)", fontVariantNumeric: "tabular-nums" }}>
          {selected.length === 0
            ? "未选任何期"
            : `将入库：${selected.length} 期 · ${stats.items} 条（建议生效 ${stats.withProposal} 条 · 无建议 ${stats.without} 条按当前归属直接入库）`}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-xs shrink-0" style={{ color: "var(--fg-muted)", letterSpacing: "0.08em" }}>
            入库期数
          </span>
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 min-w-0">
            {dates.map((d) => (
              <label
                key={d}
                className="flex items-center gap-1.5 text-xs cursor-pointer select-none"
                style={{ color: unchecked.has(d) ? "var(--fg-muted)" : "var(--fg)", fontVariantNumeric: "tabular-nums" }}
              >
                <input
                  type="checkbox"
                  checked={!unchecked.has(d)}
                  onChange={() => toggle(d)}
                  style={{ accentColor: "var(--accent)" }}
                  aria-label={`选择入库期 ${d}`}
                />
                {d}
              </label>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => void publish()}
              disabled={disabled}
              aria-busy={phase === "running"}
              aria-label={`确认入库所选 ${selected.length} 期 · ${stats.items} 条`}
              className="text-xs font-semibold shrink-0"
              style={{
                background: selected.length === 0 ? "var(--tag-bg)" : "var(--accent)",
                color: selected.length === 0 ? "var(--fg-muted)" : "var(--bg)",
                borderRadius: "var(--radius-control)",
                padding: "6px 14px",
                border: "none",
                cursor: disabled ? "default" : "pointer",
                fontFamily: "inherit",
                transition: "background var(--dur-fast) var(--ease-out)",
              }}
            >
              {phase === "running" ? "入库中…" : `确认入库（${stats.items} 条）`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

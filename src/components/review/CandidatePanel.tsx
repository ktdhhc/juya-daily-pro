"use client";

import { CSSProperties, useState } from "react";
import { ApiError, CandidateStatus, PendingCandidate } from "@/lib/api";
import { candidateYamlSnippet } from "@/lib/review-yaml";

type ReviewCandidate = PendingCandidate & { sourceItemId: string };

interface Props {
  /** pending 候选全量（GET /api/review/pending 的 candidates，spec10-02 实际交付） */
  candidates: ReviewCandidate[];
  /** 处置回调（spec16 决策 7）：标记已入册 / 忽略；成功后父层重拉 pending，候选从列表消失 */
  onDispose: (id: string, status: CandidateStatus) => Promise<void>;
}

const CONF_LABELS: Record<string, string> = { high: "高", mid: "中", low: "低" };

/** 候选公司区（spec10 票 03 + spec16 票 03）：id/name/aliases/证据/confidence + source 溯源。
 *  动作 = 「复制 YAML」（companies.yaml 追加片段到剪贴板，纯函数 src/lib/review-yaml）+
 *  「标记已入册 / 忽略」（PATCH /api/review/candidate，只改候选状态）。 */
export function CandidatePanel({ candidates, onDispose }: Props) {
  const [copiedId, setCopiedId] = useState("");
  const [busyId, setBusyId] = useState("");
  const [err, setErr] = useState<{ id: string; message: string } | null>(null);
  if (candidates.length === 0) return null;

  const copyYaml = async (c: ReviewCandidate) => {
    try {
      await navigator.clipboard.writeText(
        candidateYamlSnippet({ id: c.id, name: c.name, aliases: c.aliases }),
      );
      setCopiedId(c.id);
      setTimeout(() => setCopiedId((cur) => (cur === c.id ? "" : cur)), 1500);
    } catch {
      // 剪贴板不可达（无授权/非安全上下文）：静默，按钮回原态
    }
  };

  const dispose = async (c: ReviewCandidate, status: CandidateStatus) => {
    if (busyId !== "") return;
    setBusyId(c.id);
    setErr(null);
    try {
      await onDispose(c.id, status);
    } catch (e) {
      setErr({ id: c.id, message: e instanceof ApiError ? e.message : "网络异常，请稍后重试" });
    } finally {
      setBusyId("");
    }
  };

  return (
    <section className="mt-10" aria-label="候选公司">
      <div className="day-head">
        <span className="text-sm font-semibold" style={{ color: "var(--fg)" }}>
          候选公司
        </span>
        <span className="h-px flex-1" style={{ background: "var(--rule)" }} aria-hidden />
        <span className="facet-count">{candidates.length} 条</span>
      </div>
      <div>
        {candidates.map((c) => (
          <article key={c.id} className="rule-t py-4">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="seal seal-outline"
                style={{ "--seal": "var(--fg-muted)", width: 20, height: 20, fontSize: 11 } as CSSProperties}
                aria-hidden
              >
                {c.name.charAt(0)}
              </span>
              <span className="item-title min-w-0 truncate" style={{ fontSize: 15 }}>
                {c.name}
              </span>
              <span className="text-xs shrink-0" style={{ color: "var(--fg-muted)", fontFamily: "var(--font-mono)" }}>
                {c.id}
              </span>
              <span
                className="text-xs ml-auto shrink-0"
                style={{ color: c.confidence === "high" ? "var(--accent)" : "var(--fg-muted)" }}
                title={`置信度 ${c.confidence}`}
              >
                置信 {CONF_LABELS[c.confidence] ?? c.confidence}
              </span>
            </div>
            {c.aliases.length > 0 && (
              <div className="text-xs mt-1" style={{ color: "var(--fg-light)" }}>
                别名：{c.aliases.join(" / ")}
              </div>
            )}
            {/* 累积证据（spec16 决策 5：多段以 `；` 分隔）逐段成行，段数即「攒够」的判据 */}
            <div className="item-summary mt-1 flex flex-col" style={{ fontSize: 13 }}>
              {c.reason.split("；").map((seg, i) => (
                <span key={i}>{seg}</span>
              ))}
            </div>
            <div className="item-foot mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>来源 {c.sourceItemId}</span>
              <button type="button" className="text-link" onClick={() => void copyYaml(c)}>
                {copiedId === c.id ? "已复制" : "复制 YAML"}
              </button>
              <span className="flex items-center gap-4">
                <button
                  type="button"
                  className="text-link"
                  disabled={busyId !== ""}
                  onClick={() => void dispose(c, "registered")}
                >
                  标记已入册
                </button>
                <button
                  type="button"
                  className="text-link"
                  disabled={busyId !== ""}
                  onClick={() => void dispose(c, "dismissed")}
                >
                  忽略
                </button>
              </span>
              {busyId === c.id && (
                <span style={{ color: "var(--fg-muted)" }} aria-live="polite">
                  处置中 …
                </span>
              )}
            </div>
            {err !== null && err.id === c.id && (
              <p className="mt-1 text-xs" style={{ color: "var(--accent)" }} role="alert">
                {err.message}
              </p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

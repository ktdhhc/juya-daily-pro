"use client";

import { CSSProperties, useState } from "react";
import { PendingCandidate } from "@/lib/api";
import { candidateYamlSnippet } from "@/lib/review-yaml";

type ReviewCandidate = PendingCandidate & { sourceItemId: string };

interface Props {
  /** pending 候选全量（GET /api/review/pending 的 candidates，spec10-02 实际交付） */
  candidates: ReviewCandidate[];
}

const CONF_LABELS: Record<string, string> = { high: "高", mid: "中", low: "低" };

/** 候选公司区（spec10 票 03）：id/name/aliases/reason/confidence + source 溯源。
 *  动作 = 「复制 YAML」（companies.yaml 追加片段到剪贴板，纯函数 src/lib/review-yaml）；
 *  「标记已入册 / 忽略」仅视觉禁用——候选状态端点待 spec10-04，UI 只读展示。 */
export function CandidatePanel({ candidates }: Props) {
  const [copiedId, setCopiedId] = useState("");
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
            <p className="item-summary mt-1" style={{ fontSize: 13 }}>
              {c.reason}
            </p>
            <div className="item-foot mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>来源 {c.sourceItemId}</span>
              <button type="button" className="text-link" onClick={() => void copyYaml(c)}>
                {copiedId === c.id ? "已复制" : "复制 YAML"}
              </button>
              {/* 待 spec10-04：候选状态端点未交付，仅视觉禁用 */}
              <span className="flex items-center gap-4" style={{ opacity: 0.4 }} title="候选状态端点待 spec10-04 交付">
                <button type="button" className="text-link" disabled aria-disabled="true">
                  标记已入册
                </button>
                <button type="button" className="text-link" disabled aria-disabled="true">
                  忽略
                </button>
              </span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

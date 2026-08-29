"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Header } from "@/components/Header";
import { AdminGate } from "@/components/common/AdminGate";
import { EmptyState } from "@/components/common/EmptyState";
import { CandidatePanel } from "@/components/review/CandidatePanel";
import { PublishBar } from "@/components/review/PublishBar";
import { StagedIssueList } from "@/components/review/StagedIssueList";
import {
  ApiError,
  CompanyIndexEntry,
  PatchOutcome,
  PatchOwnersBody,
  PendingPayload,
  PublishOutcome,
  apiFetch,
  fetchPendingReview,
  patchReviewItem,
  publishReview,
  triggerParse,
} from "@/lib/api";
import { isAdmin } from "@/lib/auth";

type LoadStatus = "loading" | "ready" | "empty" | "error";
type ParsePhase = "idle" | "running" | "ok" | "fail";

/** 骨架：.galley 结构同构块 + 墨迹扫过（FRONTEND_DESIGN §4.5，替代 animate-pulse） */
function ReviewSkeleton() {
  return (
    <div className="pb-10" aria-busy="true">
      <div className="day-head">
        <div className="galley h-3 w-36" />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="rule-t py-4 flex flex-col gap-2">
          <div className="galley h-4" style={{ width: `${76 - i * 10}%` }} />
          <div className="galley h-3" style={{ width: "34%" }} />
          <div className="galley h-3" style={{ width: "52%" }} />
        </div>
      ))}
      <span className="v-label absolute" aria-hidden>
        排版中 …
      </span>
    </div>
  );
}

/** 审核工作流页（spec10 票 03）：进页（访客 AdminGate 原地解锁）→「运行解析」→ 逐条检查/编辑
 *  （PATCH 即时提交，失败回滚）→ 候选公司区（复制 YAML）→「确认入库」→ 已发布期消失。 */
export default function ReviewPage() {
  // 管理员态：挂载后读一次 localStorage（静态导出首帧按访客渲染，避免水合错位——同 Header 范式）
  const [admin, setAdmin] = useState(false);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [data, setData] = useState<PendingPayload | null>(null);
  const [errMsg, setErrMsg] = useState("");
  // 公司索引（编辑器「新增归属」选源）
  const [companies, setCompanies] = useState<CompanyIndexEntry[]>([]);

  const loadPending = useCallback(() => {
    setStatus("loading");
    setErrMsg("");
    fetchPendingReview()
      .then((payload) => {
        setData(payload);
        setStatus(payload.dates.length === 0 && payload.candidates.length === 0 ? "empty" : "ready");
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
    loadPending();
    // 公司索引（编辑器「新增归属」选源）：失败降级为「无匹配」，不阻塞审核主流程
    apiFetch<{ companies: CompanyIndexEntry[] }>("/api/companies")
      .then((r) => setCompanies(r.companies))
      .catch(() => setCompanies([]));
  }, [admin, loadPending]);

  // 「运行解析」（动线第一步）：POST /api/parse → 摘要小条（Header 同步反馈语言）→ 重拉 pending
  const [parsePhase, setParsePhase] = useState<ParsePhase>("idle");
  const [parseMsg, setParseMsg] = useState("");
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const parsingRef = useRef(false);

  const runParse = useCallback(async () => {
    if (parsingRef.current) return;
    parsingRef.current = true;
    setParsePhase("running");
    try {
      const res = await triggerParse();
      setParseMsg(
        `解析 ${res.processed} 条 · 新增候选 ${res.candidatesFound} 条 · 余量 ${res.remaining}` +
          `${res.skipped > 0 ? ` · 失败 ${res.skipped}` : ""}`
      );
      setParseErrors(res.errors);
      setParsePhase("ok");
      loadPending();
    } catch (e) {
      setParseMsg(
        e instanceof ApiError ? (e.code === "unauthorized" ? "需要管理口令" : e.message) : "网络异常，请稍后重试"
      );
      setParsePhase("fail");
    } finally {
      parsingRef.current = false;
    }
  }, [loadPending]);

  // 成功摘要小条约 5s 自散；失败保留 + 重试（spec06 B4 同款）
  useEffect(() => {
    if (parsePhase !== "ok") return;
    const t = setTimeout(() => setParsePhase("idle"), 5000);
    return () => clearTimeout(t);
  }, [parsePhase]);

  // 单条目 PATCH（ProposalEditor 变更即调）：成功后本地回写 owners + proposal（llm_model='human-edit'，
  // 与 worker patchStatements 语义一致），失败直接抛错由编辑器回滚
  const patchItem = useCallback(
    async (itemId: string, owners: PatchOwnersBody[]): Promise<PatchOutcome> => {
      const res = await patchReviewItem(itemId, owners);
      setData((prev) =>
        prev === null
          ? prev
          : {
              ...prev,
              dates: prev.dates.map((g) => ({
                ...g,
                items: g.items.map((it) =>
                  it.id === itemId
                    ? {
                        ...it,
                        owners: owners.map((o) => {
                          const known =
                            it.owners.find((x) => x.companyId === o.companyId) ??
                            companies.find((c) => c.id === o.companyId);
                          return {
                            companyId: o.companyId,
                            name: known?.name ?? o.companyId,
                            color: known?.color ?? "#888888",
                            role: o.role,
                          };
                        }),
                        proposal: { owners, llmModel: "human-edit" },
                      }
                    : it,
                ),
              })),
            }
      );
      return res;
    },
    [companies]
  );

  // 确认入库：POST /api/review/publish → 重拉 pending（已发布期消失）
  const publishDates = useCallback(
    async (dates: string[]): Promise<PublishOutcome> => {
      const res = await publishReview(dates);
      loadPending();
      return res;
    },
    [loadPending]
  );

  const pendingDates = useMemo(() => (data ? data.dates.map((g) => g.date) : []), [data]);
  const stagedCount = useMemo(
    () => (data ? data.dates.reduce((n, g) => n + g.items.length, 0) : 0),
    [data]
  );

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: "var(--bg)" }}>
      <Header active="review" />

      {!admin ? (
        /* 访客：§4.6 空态 + AdminGate 原地解锁（spec08 模式） */
        <main className="flex-1">
          <EmptyState
            phrase="非请莫入"
            description="此页为编辑审核工作区，访客不可见；输入管理口令后原地解锁。"
          />
          <div className="max-w-sm mx-auto pb-16">
            <AdminGate onVerified={() => setAdmin(true)} />
          </div>
        </main>
      ) : (
        <>
          {/* 工具行：待审计数 + 运行解析 */}
          <div className="max-w-6xl mx-auto w-full px-5 pt-4 flex items-center gap-4">
            <h1 className="text-sm font-semibold shrink-0" style={{ color: "var(--fg)" }}>
              审核工作流
            </h1>
            {status === "ready" && (
              <span
                className="text-xs min-w-0 truncate"
                style={{ color: "var(--fg-muted)", fontVariantNumeric: "tabular-nums" }}
              >
                待审 {data?.dates.length ?? 0} 期 · {stagedCount} 条
              </span>
            )}
            <button
              type="button"
              className="text-link text-xs ml-auto shrink-0"
              onClick={() => void runParse()}
              disabled={parsePhase === "running"}
              aria-busy={parsePhase === "running"}
            >
              {parsePhase === "running" ? "解析中…" : "运行解析"}
            </button>
          </div>

          {/* 解析摘要/失败细线小条（复用 Header 同步反馈语言；失败含错误首条与重试） */}
          {parsePhase === "ok" && (
            <div className="rule-t mt-3">
              <div
                className="max-w-6xl mx-auto px-5 py-1.5 text-xs flex items-center gap-2 fade-up min-w-0"
                style={{ color: "var(--fg-muted)", fontVariantNumeric: "tabular-nums" }}
                role="status"
              >
                <span aria-hidden style={{ color: "var(--accent)" }}>
                  ●
                </span>
                <span className="shrink-0">{parseMsg}</span>
                {parseErrors.length > 0 && (
                  <span className="min-w-0 truncate" title={parseErrors.join("；")}>
                    {parseErrors[0]}
                  </span>
                )}
              </div>
            </div>
          )}
          {parsePhase === "fail" && (
            <div className="rule-t mt-3">
              <div
                className="max-w-6xl mx-auto px-5 py-1.5 text-xs flex items-center gap-2 fade-up min-w-0"
                style={{ color: "var(--fg-muted)" }}
                role="status"
              >
                <span className="min-w-0 truncate">{parseMsg}</span>
                <button type="button" className="text-link shrink-0" onClick={() => void runParse()}>
                  重试
                </button>
              </div>
            </div>
          )}

          <main className="flex-1 w-full max-w-6xl mx-auto px-5 py-2">
            {status === "loading" && <ReviewSkeleton />}
            {status === "error" && (
              <EmptyState phrase="暂不可得" description={errMsg || "加载失败。"} actionLabel="重新加载" onAction={loadPending} />
            )}
            {status === "empty" && (
              <EmptyState
                phrase="暂无待审"
                description="暂存区没有待审条目——同步新数据后点「运行解析」，开始审核。"
              />
            )}
            {status === "ready" && data && (
              <>
                <StagedIssueList dates={data.dates} companies={companies} onPatch={patchItem} />
                <CandidatePanel candidates={data.candidates} />
              </>
            )}
          </main>

          {status === "ready" && data && data.dates.length > 0 && (
            <PublishBar dates={pendingDates} onPublish={publishDates} />
          )}
        </>
      )}
    </div>
  );
}

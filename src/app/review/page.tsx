"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Header } from "@/components/Header";
import { AdminGate } from "@/components/common/AdminGate";
import { EmptyState } from "@/components/common/EmptyState";
import { CandidatePanel } from "@/components/review/CandidatePanel";
import { HistoryPanel } from "@/components/review/HistoryPanel";
import {
  LastParseRecord,
  ParsePanel,
  ParsePhase,
  loadLastParse,
  saveLastParse,
} from "@/components/review/ParsePanel";
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
import { categorizePending } from "@/lib/review";

type LoadStatus = "loading" | "ready" | "empty" | "error";

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

/** 审核台（spec10 票 03 + spec12 票 02 收件箱化）：进页（访客 AdminGate 原地解锁）→ 三态计数状态条
 *  →「运行解析」（结果常驻 + 再跑一次）→ 条目按 待解析/已解析待确认/无需解析 分组（missing_owner
 *  行内显候选）→ 候选公司区（复制 YAML）→ 确认入库（实时预览）→ 同步历史折叠区。 */
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

  // 「运行解析」（动线第一步）：响应整体落 localStorage["juya-last-parse"]（spec12 契约 C），
  // ParsePanel 常驻展示最近一次结果；解析幂等，重跑只补漏
  const [parsePhase, setParsePhase] = useState<ParsePhase>("idle");
  const [parseFailMsg, setParseFailMsg] = useState("");
  const [lastParse, setLastParse] = useState<LastParseRecord | null>(null);
  const parsingRef = useRef(false);

  useEffect(() => {
    if (!admin) return;
    setLastParse(loadLastParse()); // 挂载读最近一次解析结果（首帧不读，避免 SSR/水合错位）
  }, [admin]);

  const runParse = useCallback(async () => {
    if (parsingRef.current) return;
    parsingRef.current = true;
    setParsePhase("running");
    try {
      const res = await triggerParse();
      setLastParse(saveLastParse(res));
      setParsePhase("idle");
      loadPending();
    } catch (e) {
      setParseFailMsg(
        e instanceof ApiError ? (e.code === "unauthorized" ? "需要管理口令" : e.message) : "网络异常，请稍后重试"
      );
      setParsePhase("fail");
    } finally {
      parsingRef.current = false;
    }
  }, [loadPending]);

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

  // 三态分组（spec12 契约 B）：组序 = 待解析 → 已解析待确认 → 无需解析，即渲染序
  const groups = useMemo(() => categorizePending(data ? data.dates.flatMap((g) => g.items) : []), [data]);

  return (
    <div className="min-h-dvh flex flex-col pb-24" style={{ background: "var(--bg)" }}>
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
          {/* 工具行：标题 + 运行解析（计数移入下方三态状态条） */}
          <div className="max-w-6xl mx-auto w-full px-5 pt-4 flex items-center gap-4">
            <h1 className="text-sm font-semibold shrink-0" style={{ color: "var(--fg)" }}>
              审核工作流
            </h1>
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

          {/* 三态计数状态条（spec12 契约 B）：待解析非空时朱橙提示（收件箱「需处理」语义） */}
          {status === "ready" && (
            <div className="rule-t mt-3">
              <div
                className="max-w-6xl mx-auto px-5 py-1.5 text-xs flex items-center gap-2 flex-wrap"
                style={{ color: "var(--fg-muted)", fontVariantNumeric: "tabular-nums" }}
                role="status"
              >
                <span style={{ color: groups.unparsed.length > 0 ? "var(--accent)" : undefined }}>
                  待解析 {groups.unparsed.length}
                </span>
                <span aria-hidden>·</span>
                <span>已解析待确认 {groups.parsed.length}</span>
                <span aria-hidden>·</span>
                <span>无需解析 {groups.noNeed.length}</span>
              </div>
            </div>
          )}

          {/* 解析区（spec12 契约 C）：最近一次结果常驻 + 逐条错误 + 再跑一次 */}
          <ParsePanel
            last={lastParse}
            phase={parsePhase}
            failMsg={parseFailMsg}
            onRun={() => void runParse()}
          />

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
                <StagedIssueList groups={groups} companies={companies} onPatch={patchItem} />
                <CandidatePanel candidates={data.candidates} />
              </>
            )}
            {(status === "ready" || status === "empty") && <HistoryPanel />}
          </main>

          {status === "ready" && data && data.dates.length > 0 && (
            <PublishBar groups={data.dates} onPublish={publishDates} />
          )}
        </>
      )}
    </div>
  );
}

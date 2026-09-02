"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Header } from "@/components/Header";
import { AdminGate } from "@/components/common/AdminGate";
import { EmptyState } from "@/components/common/EmptyState";
import { CandidatePanel } from "@/components/review/CandidatePanel";
import { FlowHeader } from "@/components/review/FlowHeader";
import { HistoryPanel } from "@/components/review/HistoryPanel";
import { LastParseRecord, ParsePanel, loadLastParse, saveLastParse } from "@/components/review/ParsePanel";
import { PublishBar } from "@/components/review/PublishBar";
import { StagedIssueList } from "@/components/review/StagedIssueList";
import {
  ApiError,
  CompanyIndexEntry,
  ParseJobStatus,
  ParseStatePayload,
  PatchOutcome,
  PatchOwnersBody,
  PendingPayload,
  PublishOutcome,
  ReviewHistory,
  apiFetch,
  fetchPendingReview,
  fetchReviewHistory,
  patchReviewItem,
  publishReview,
  triggerParse,
} from "@/lib/api";
import { isAdmin } from "@/lib/auth";
import { categorizePending, flowCounts, parsePollStopRefresh, shouldPollParse } from "@/lib/review";

type LoadStatus = "loading" | "ready" | "empty" | "error";

/** 轮询周期（spec13 契约 D）：parse.status==='running' 时每 3s 静默重拉 pending */
const PARSE_POLL_MS = 3000;

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

/** 审核台（spec10 票 03 + spec12 票 02 收件箱化 + spec13 票 02 作业化）：进页（访客 AdminGate 原地解锁）
 *  → 数据流标头（同步→解析→入库三段流水线）→ 三态计数状态条 →「运行解析」（秒回启动，轮询推进）→
 *  解析区 → 条目按 待解析/已解析待确认/无需解析 分组 → 候选公司区 → 确认入库 → 同步历史折叠区。 */
export default function ReviewPage() {
  // 管理员态：挂载后读一次 localStorage（静态导出首帧按访客渲染，避免水合错位——同 Header 范式）
  const [admin, setAdmin] = useState(false);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [data, setData] = useState<PendingPayload | null>(null);
  const [errMsg, setErrMsg] = useState("");
  // 公司索引（编辑器「新增归属」选源）
  const [companies, setCompanies] = useState<CompanyIndexEntry[]>([]);
  // 数据流标头③段（spec13 契约 E）：同步历史挂载取一次，published>0 过滤在 flowCounts 内做
  const [historyRows, setHistoryRows] = useState<ReviewHistory[]>([]);

  const applyPending = useCallback((payload: PendingPayload) => {
    setData(payload);
    setStatus(payload.dates.length === 0 && payload.candidates.length === 0 ? "empty" : "ready");
  }, []);

  const loadPending = useCallback(() => {
    setStatus("loading");
    setErrMsg("");
    fetchPendingReview()
      .then(applyPending)
      .catch((e: unknown) => {
        setStatus("error");
        setErrMsg(
          e instanceof ApiError ? (e.code === "unauthorized" ? "需要管理口令" : e.message) : "网络异常，请稍后重试"
        );
      });
  }, [applyPending]);

  /** 轮询 / 终态补拉用静默重拉：不闪骨架，失败静默（等下一轮 3s 再试） */
  const refreshPending = useCallback(() => {
    fetchPendingReview()
      .then(applyPending)
      .catch(() => {});
  }, [applyPending]);

  useEffect(() => setAdmin(isAdmin()), []);

  useEffect(() => {
    if (!admin) return;
    loadPending();
    // 公司索引（编辑器「新增归属」选源）：失败降级为「无匹配」，不阻塞审核主流程
    apiFetch<{ companies: CompanyIndexEntry[] }>("/api/companies")
      .then((r) => setCompanies(r.companies))
      .catch(() => setCompanies([]));
    // 数据流标头③段（spec13 契约 E）：入库期数/条数挂载取一次
    fetchReviewHistory(30)
      .then((r) => setHistoryRows(r.history))
      .catch(() => setHistoryRows([]));
  }, [admin, loadPending]);

  // ── 解析作业状态机（spec13 契约 B/C/D/F）：运行态一律以服务端 data.parse 为准，
  //    本地只留 POST 瞬态（starting/fail）与 409 提示；localStorage 降级为终态缓存 ──
  const parseState: ParseStatePayload | null = data?.parse ?? null;
  const parseStatus = parseState?.status;
  const [postPhase, setPostPhase] = useState<"idle" | "starting" | "fail">("idle");
  const [postErrMsg, setPostErrMsg] = useState("");
  const [busyHint, setBusyHint] = useState("");
  const parseBusy = postPhase === "starting" || parseStatus === "running";
  const [lastParse, setLastParse] = useState<LastParseRecord | null>(null);
  const startingRef = useRef(false);

  useEffect(() => {
    if (!admin) return;
    setLastParse(loadLastParse()); // 挂载读终态缓存（首帧不读，避免 SSR/水合错位）
  }, [admin]);

  const runParse = useCallback(async () => {
    if (startingRef.current || parseStatus === "running") return;
    startingRef.current = true;
    setBusyHint("");
    setPostPhase("starting");
    try {
      // spec13 契约 B：秒回 { started, state }，解析本体在服务端继续——立即合并 state 进入轮询视野
      const res = await triggerParse();
      let merged = false;
      setData((prev) => {
        if (prev) {
          merged = true;
          return { ...prev, parse: res.state };
        }
        return prev;
      });
      if (!merged) refreshPending(); // 数据未就绪（初始加载失败等）：拉一次全量（内含 parse 字段）
      else if (res.state.status === "done" && (res.state.processed ?? 0) > 0) refreshPending(); // 瞬时完成（空池外极小概率）：补拉新建议
      setPostPhase("idle");
    } catch (e) {
      if (e instanceof ApiError && e.code === "parse_busy") {
        // 409（另一处已在跑）：立即接入进度——拉一次最新 state，轮询 effect 随 running 接管
        setBusyHint("另一处已在运行解析，已接入进度");
        refreshPending();
        setPostPhase("idle");
      } else {
        setPostErrMsg(
          e instanceof ApiError ? (e.code === "unauthorized" ? "需要管理口令" : e.message) : "网络异常，请稍后重试"
        );
        setPostPhase("fail");
      }
    } finally {
      startingRef.current = false;
    }
  }, [parseStatus, refreshPending]);

  // 轮询（spec13 契约 D）：仅 running 每 3s 静默重拉；每次响应更换 parse 对象 → effect 重置定时器，
  // 天然避免请求叠发；组件卸载 / 状态离开 running 由 effect cleanup 清定时器
  useEffect(() => {
    if (!admin || !shouldPollParse(parseState)) return;
    const t = setInterval(refreshPending, PARSE_POLL_MS);
    return () => clearInterval(t);
  }, [admin, parseState, refreshPending]);

  // 终态转换（spec13 契约 D/F）：轮询中 → done/failed 时停轮（上方轮询 effect 自行收尾）并补拉一次
  // 数据（新建议落地，done 且 processed>0 才补拉）；顺带把终态写入本机缓存（降级语义，仅转换时写一次）
  const prevParseStatusRef = useRef<ParseJobStatus | undefined>(undefined);
  useEffect(() => {
    const prev = prevParseStatusRef.current;
    prevParseStatusRef.current = parseStatus;
    if (parsePollStopRefresh(prev, parseState)) refreshPending();
    if (parseState && (parseState.status === "done" || parseState.status === "failed") && prev !== parseStatus) {
      setLastParse(saveLastParse(parseState));
    }
  }, [parseState, parseStatus, refreshPending]);

  // 数据流标头跳转（spec13 契约 E）：① 条目区顶部 / ② 解析区 / ③ 发布条；目标未渲染（未加载/未展开）静默。
  // sticky 报头会遮住落点，预留报头高度。
  const jumpTo = useCallback((target: "staged" | "parse" | "published") => {
    const id = target === "staged" ? "review-staged" : target === "parse" ? "review-parse" : "review-publish";
    const el = document.getElementById(id);
    if (!el) return;
    const headerH = document.querySelector(".site-header")?.getBoundingClientRect().height ?? 0;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - headerH - 8, behavior: "smooth" });
  }, []);

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

  // 数据流标头三段（spec13 契约 E）：flowCounts 纯函数汇总（30 条同步历史内 published>0 过滤）
  const flowSegments = useMemo(
    () => flowCounts(data ? data.dates.reduce((n, g) => n + g.items.length, 0) : 0, parseState, historyRows),
    [data, parseState, historyRows]
  );

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
          {/* 工具行：标题 + 运行解析（spec13 契约 F：running 禁用并显进度 k/M） */}
          <div className="max-w-6xl mx-auto w-full px-5 pt-4 flex items-center gap-4">
            <h1 className="text-sm font-semibold shrink-0" style={{ color: "var(--fg)" }}>
              审核工作流
            </h1>
            <button
              type="button"
              className="text-link text-xs ml-auto shrink-0"
              onClick={() => void runParse()}
              disabled={parseBusy}
              aria-busy={parseBusy}
            >
              {parseBusy
                ? parseStatus === "running"
                  ? `解析中 ${parseState?.processed ?? 0}/${parseState?.total ?? 0}…`
                  : "解析中…"
                : "运行解析"}
            </button>
          </div>

          {/* 数据流标头（spec13 契约 E）：同步 → 解析 → 入库三段流水线，点击段落平滑滚动 */}
          {data && <FlowHeader segments={flowSegments} onJump={jumpTo} />}

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
                {groups.blocked.length > 0 && (
                  <>
                    <span aria-hidden>·</span>
                    <span style={{ color: "var(--accent)" }}>缺候选待入册 {groups.blocked.length}</span>
                  </>
                )}
                <span aria-hidden>·</span>
                <span>已解析待确认 {groups.parsed.length}</span>
                <span aria-hidden>·</span>
                <span>无需解析 {groups.noNeed.length}</span>
              </div>
            </div>
          )}

          {/* 解析区（spec12 契约 C + spec13 契约 F）：服务端作业状态驱动——运行进度/完成摘要/失败原因 + 终态缓存兜底 */}
          <ParsePanel
            state={parseState}
            postPhase={postPhase}
            postErrMsg={postErrMsg}
            busyHint={busyHint}
            last={lastParse}
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

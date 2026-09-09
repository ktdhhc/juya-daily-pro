"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Header } from "@/components/Header";
import { AdminGate } from "@/components/common/AdminGate";
import { EmptyState } from "@/components/common/EmptyState";
import { CandidatePanel } from "@/components/review/CandidatePanel";
import { FlowCard } from "@/components/review/FlowCard";
import { LastParseRecord, loadLastParse, saveLastParse } from "@/components/review/last-parse";
import { PublishBar } from "@/components/review/PublishBar";
import { StagedIssueList } from "@/components/review/StagedIssueList";
import { SyncRunsTable } from "@/components/review/SyncRunsTable";
import {
  ApiError,
  CandidateStatus,
  CompanyIndexEntry,
  ParseJobStatus,
  ParseStatePayload,
  PatchOutcome,
  PatchOwnersBody,
  PendingPayload,
  PublishOutcome,
  ReviewHistory,
  SyncRun,
  apiFetch,
  fetchPendingReview,
  fetchReviewHistory,
  fetchSyncRuns,
  patchReviewCandidate,
  patchReviewItem,
  publishReview,
  triggerParse,
  triggerSync,
} from "@/lib/api";
import { isAdmin } from "@/lib/auth";
import { categorizePending, defaultTodoTab, parsePollStopRefresh, shouldPollParse, todoTabs, TodoTabKey } from "@/lib/review";

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

/** 审核台（spec14 票 02 三层重做）：进页（访客 AdminGate 原地解锁）→ 今日流水线卡（三段行 + 三按钮）
 *  → 待办 tab（待审核 / 缺候选待入册 / 异常，默认落第一个非空）→ 候选公司区 → 确认入库 → 同步运行记录表。
 *  解析作业轮询机制（spec13 契约 D/F）原样保留；旧 FlowHeader / 页顶状态条 / ParsePanel / HistoryPanel 废弃删除。 */
export default function ReviewPage() {
  // 管理员态：挂载后读一次 localStorage（静态导出首帧按访客渲染，避免水合错位——同 Header 范式）
  const [admin, setAdmin] = useState(false);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [data, setData] = useState<PendingPayload | null>(null);
  const [errMsg, setErrMsg] = useState("");
  // 公司索引（编辑器「新增归属」选源）
  const [companies, setCompanies] = useState<CompanyIndexEntry[]>([]);
  // 今日卡③行（spec14 契约 C）：入库期数/条数汇总源，published>0 过滤在 flowCardRows 内做
  const [historyRows, setHistoryRows] = useState<ReviewHistory[]>([]);
  // 今日卡①行 + 同步运行记录表（spec14 契约 B/E）：最新一行与全表同源
  const [syncRuns, setSyncRuns] = useState<SyncRun[]>([]);
  // 同步瞬态：running 互斥（Header 同步按钮与今日卡次按钮共用语义）；fail 行内错误（spec14 废弃成功 toast，fail 保留）
  const [syncing, setSyncing] = useState(false);
  const [syncErrMsg, setSyncErrMsg] = useState("");
  const syncingRef = useRef(false);

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

  /** 运行记录静默重拉（同步完成后今日卡①行与 SyncRunsTable 一并更新） */
  const refreshSyncRuns = useCallback(() => {
    fetchSyncRuns(20)
      .then((r) => setSyncRuns(r.runs))
      .catch(() => {});
  }, []);

  useEffect(() => setAdmin(isAdmin()), []);

  useEffect(() => {
    if (!admin) return;
    loadPending();
    // 公司索引（编辑器「新增归属」选源）：失败降级为「无匹配」，不阻塞审核主流程
    apiFetch<{ companies: CompanyIndexEntry[] }>("/api/companies")
      .then((r) => setCompanies(r.companies))
      .catch(() => setCompanies([]));
    // 今日卡③行（spec14 契约 C）：入库汇总挂载取一次
    fetchReviewHistory(30)
      .then((r) => setHistoryRows(r.history))
      .catch(() => setHistoryRows([]));
    // 今日卡①行 + 同步运行记录表（spec14 契约 B）
    refreshSyncRuns();
  }, [admin, loadPending, refreshSyncRuns]);

  // ── 解析作业状态机（spec13 契约 B/C/D/F 原样保留）：运行态一律以服务端 data.parse 为准，
  //    本地只留 POST 瞬态（starting/fail）与 409 提示；localStorage 降级为终态缓存（今日卡②行兜底）──
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

  // ── 同步（spec14 契约 C/E）：今日卡次按钮 + 失败行就地重试共用；成功静默（今日卡①行常驻显示结果），
  //    失败行内错误保留 + 重试。运行完成后重拉 pending（暂存计数变化）与运行记录。──
  const runSync = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    setSyncErrMsg("");
    try {
      const res = await triggerSync();
      if (!res.ok) {
        const f = res.failures[0];
        setSyncErrMsg(f ? `${f.date} · ${f.error}` : "同步失败");
      }
      refreshPending();
      refreshSyncRuns();
    } catch (e) {
      setSyncErrMsg(
        e instanceof ApiError
          ? e.code === "unauthorized"
            ? "需要管理口令"
            : e.message
          : "网络异常，请稍后重试"
      );
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [refreshPending, refreshSyncRuns]);

  // 今日卡主按钮：平滑滚动到待办 tab 区（锚点 #review-todos）；sticky 报头会遮住落点，预留报头高度
  const jumpToTodos = useCallback(() => {
    const el = document.getElementById("review-todos");
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

  // 候选处置（spec16 决策 7）：标记已入册 / 忽略 → 成功后静默重拉 pending（候选从列表消失）
  const disposeCandidate = useCallback(
    async (id: string, status: CandidateStatus): Promise<void> => {
      await patchReviewCandidate(id, status);
      refreshPending();
    },
    [refreshPending]
  );

  // 确认入库：POST /api/review/publish → 重拉 pending（已发布期消失）+ 入库汇总（③行随动）
  const publishDates = useCallback(
    async (dates: string[]): Promise<PublishOutcome> => {
      const res = await publishReview(dates);
      loadPending();
      fetchReviewHistory(30)
        .then((r) => setHistoryRows(r.history))
        .catch(() => {});
      return res;
    },
    [loadPending]
  );

  // 三态分组（spec12 契约 B）：供 todoTabs 归并与 PublishBar 复用
  const groups = useMemo(() => categorizePending(data ? data.dates.flatMap((g) => g.items) : []), [data]);

  // 待办 tab（spec14 契约 D）：归并 + 默认落点（第一个非空 tab，全空 → 待审核）。
  // 用户手动切 tab 即记录选择（不做自动跳走）；数据重拉后 tab 计数更新、落点保持用户所在 tab
  const tabs = useMemo(() => todoTabs(groups, parseState?.errors ?? []), [groups, parseState]);
  const fallbackKey = useMemo(() => defaultTodoTab([tabs[0].count, tabs[1].count, tabs[2].count]), [tabs]);
  const [userTabKey, setUserTabKey] = useState<TodoTabKey | null>(null);
  const activeTabKey = userTabKey && tabs.some((t) => t.key === userTabKey) ? userTabKey : fallbackKey;

  // 今日卡②行 post 瞬态提示（POST 失败灰字 / 409 提示；运行态由服务端 parse 字段表达，不在此重复）
  const parseHint = postPhase === "fail" ? postErrMsg : busyHint;

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
          {/* 工具行：标题（今日流水线卡自带按钮行，标题行只留名目） */}
          <div className="max-w-6xl mx-auto w-full px-5 pt-4 flex items-center gap-4">
            <h1 className="text-sm font-semibold shrink-0" style={{ color: "var(--fg)" }}>
              审核工作流
            </h1>
          </div>

          {/* 今日流水线卡（spec14 契约 C）：三段行 + 按钮行；数据就绪即渲染（无记录显「尚未同步」） */}
          {data && (
            <FlowCard
              latestRun={syncRuns[0] ?? null}
              syncing={syncing}
              parse={parseState}
              lastParse={lastParse}
              history={historyRows}
              todoCount={tabs[0].count}
              onGoTodos={jumpToTodos}
              onSync={() => void runSync()}
              onRunParse={() => void runParse()}
              parseBusy={parseBusy}
              parseProcessed={parseState?.processed ?? 0}
              parseTotal={parseState?.total ?? 0}
              parseHint={parseHint}
            />
          )}

          {/* 同步失败行内错误（spec14 废弃成功 toast；fail 分支保留为行内错误 + 重试） */}
          {syncErrMsg && (
            <div className="max-w-6xl mx-auto w-full px-5 mt-2">
              <div className="rule-t py-1.5 text-xs flex items-center gap-2 min-w-0" style={{ color: "var(--fg-muted)" }} role="alert">
                <span className="min-w-0 truncate" style={{ color: "var(--accent)" }} title={syncErrMsg}>
                  {syncErrMsg}
                </span>
                <button type="button" className="text-link shrink-0" onClick={() => void runSync()} disabled={syncing}>
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
                {/* 待办 tab 区（spec14 契约 D）：待审核 / 缺候选待入册 / 异常；锚点 #review-todos */}
                <StagedIssueList
                  groups={groups}
                  parseErrors={parseState?.errors ?? []}
                  activeKey={activeTabKey}
                  onTabChange={setUserTabKey}
                  companies={companies}
                  onPatch={patchItem}
                />
                <CandidatePanel candidates={data.candidates} onDispose={disposeCandidate} />
              </>
            )}
            {(status === "ready" || status === "empty") && (
              /* 同步运行记录表（spec14 契约 E，替代 HistoryPanel）：与今日卡①行同源 */
              <SyncRunsTable onRetry={() => void runSync()} syncing={syncing} />
            )}
          </main>

          {status === "ready" && data && data.dates.length > 0 && (
            <PublishBar groups={data.dates} onPublish={publishDates} />
          )}
        </>
      )}
    </div>
  );
}

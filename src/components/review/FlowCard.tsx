"use client";

import { LastParseRecord } from "./last-parse";
import { ParseStatePayload, ReviewHistory, SyncRun } from "@/lib/api";
import { FlowCardRow, flowCardRows } from "@/lib/review";

interface Props {
  /** sync_runs 最新一行（GET /api/review/sync-runs 倒序首行；无记录 = 尚未同步，spec14 契约 C） */
  latestRun: SyncRun | null;
  /** 同步运行中（Header/今日卡互斥标志）：① 行「同步中…」呼吸点标、次按钮禁用 */
  syncing: boolean;
  /** 服务端解析作业状态（spec13 契约 C，运行态以此为准） */
  parse: ParseStatePayload | null;
  /** localStorage["juya-last-parse"] 终态缓存：服务端 idle / 未交付 parse 字段时②行兜底（spec13 降级语义保留） */
  lastParse: LastParseRecord | null;
  /** 已入库汇总（GET /api/review/history，published>0 过滤在 flowCardRows 内做） */
  history: ReviewHistory[];
  /** 待审核总数（N = parsed + noNeed，categorizePending 归并后计数） */
  todoCount: number;
  /** 主按钮：滚到待办 tab 区（#review-todos），N=0 时禁用不触发 */
  onGoTodos: () => void;
  /** 次按钮：触发同步（POST /api/sync）；运行中互斥禁用 */
  onSync: () => void;
  /** 次按钮：运行解析（POST /api/parse，spec13 异步作业；running 禁用） */
  onRunParse: () => void;
  /** 解析作业 running（按钮禁用显「解析中 k/M…」） */
  parseBusy: boolean;
  /** 解析 running 进度（按钮文案） */
  parseProcessed: number;
  parseTotal: number;
  /** 解析启动/409/POST 失败的行内提示（既有 page 态透传，①②行之下细字） */
  parseHint: string;
}

/** 今日流水线卡（spec14 契约 C，替代 FlowHeader + 页顶状态条 + ParsePanel 首屏）：
 *  三段行（①已同步 ②解析 ③已入库，tabular、rule-t 分隔）+ 按钮行（唯一主按钮「去审核 N 条 →」+ 两次按钮）。
 *  文案由 flowCardRows 纯函数产出（src/lib/review.ts），本组件只消费渲染。
 *  呼吸点标沿用既有 .breath-dot（globals.css opacity 脉冲，禁发光）。 */
export function FlowCard({
  latestRun,
  syncing,
  parse,
  lastParse,
  history,
  todoCount,
  onGoTodos,
  onSync,
  onRunParse,
  parseBusy,
  parseProcessed,
  parseTotal,
  parseHint,
}: Props) {
  const rows = flowCardRows(latestRun, parse, lastParse, history, syncing);
  const segments: { key: "sync" | "parse" | "published"; label: string; row: FlowCardRow }[] = [
    { key: "sync", label: "已同步", row: rows.sync },
    { key: "parse", label: "解析", row: rows.parse },
    { key: "published", label: "已入库", row: rows.published },
  ];
  return (
    <section className="max-w-6xl mx-auto w-full px-5 pt-4" aria-label="今日流水线">
      <div className="rule-t">
        <div className="py-2 flex flex-col">
          {segments.map(({ key, label, row }, i) => (
            <div
              key={key}
              className={`py-1.5 text-xs flex items-baseline gap-3 min-w-0${i > 0 ? " rule-t" : ""}`}
              style={{ color: "var(--fg-muted)", fontVariantNumeric: "tabular-nums" }}
              role={row.tone === "pulse" ? "status" : undefined}
              aria-busy={row.tone === "pulse" || undefined}
            >
              <span className="shrink-0" style={{ letterSpacing: "0.08em" }}>
                {label}
              </span>
              <span
                className="min-w-0 truncate"
                style={{ color: row.tone === "accent" ? "var(--accent)" : undefined }}
                title={row.text}
              >
                {row.text}
              </span>
              {row.tone === "pulse" && (
                <span aria-hidden className="breath-dot shrink-0" style={{ color: "var(--fg)" }}>
                  ●
                </span>
              )}
              {row.tone === "accent" && (
                <span aria-hidden className="shrink-0" style={{ color: "var(--accent)", fontSize: 9, lineHeight: 1 }}>
                  ●
                </span>
              )}
            </div>
          ))}
        </div>

        {/* 解析启动/409/POST 失败行内提示（parse 契约 F 语言，失败朱橙） */}
        {parseHint && (
          <div
            className="rule-t py-1.5 text-xs min-w-0 truncate"
            style={{ color: "var(--fg-muted)" }}
            role="status"
            title={parseHint}
          >
            {parseHint}
          </div>
        )}

        {/* 按钮行：唯一主按钮（印章语义实底）+ 两次按钮（文字链），不可做时讲原因（禁用文案） */}
        <div className="py-2.5 flex flex-wrap items-center gap-x-5 gap-y-2">
          <button
            type="button"
            onClick={onGoTodos}
            disabled={todoCount === 0}
            aria-disabled={todoCount === 0}
            aria-label={todoCount > 0 ? `去审核 ${todoCount} 条` : "暂无待办"}
            className="text-xs font-semibold shrink-0"
            style={{
              background: todoCount > 0 ? "var(--accent)" : "var(--tag-bg)",
              color: todoCount > 0 ? "var(--bg)" : "var(--fg-muted)",
              borderRadius: "var(--radius-control)",
              padding: "6px 14px",
              border: "none",
              cursor: todoCount > 0 ? "pointer" : "default",
              fontFamily: "inherit",
              transition: "background var(--dur-fast) var(--ease-out)",
            }}
          >
            {todoCount > 0 ? `去审核 ${todoCount} 条 →` : "暂无待办"}
          </button>
          <button
            type="button"
            className="text-link text-xs shrink-0"
            onClick={onSync}
            disabled={syncing}
            aria-busy={syncing}
            aria-label="同步最新"
          >
            {syncing ? "同步中…" : "同步最新"}
          </button>
          <button
            type="button"
            className="text-link text-xs shrink-0"
            onClick={onRunParse}
            disabled={parseBusy}
            aria-busy={parseBusy}
            aria-label="运行解析"
          >
            {parseBusy ? (parse?.status === "running" ? `解析中 ${parseProcessed}/${parseTotal}…` : "解析中…") : "运行解析"}
          </button>
        </div>
      </div>
    </section>
  );
}

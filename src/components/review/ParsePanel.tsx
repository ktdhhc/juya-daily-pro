"use client";

import { useEffect, useState } from "react";
import { ParseStatePayload } from "@/lib/api";

// ── 「最近一次我看到的解析终态」本机缓存（spec13 契约 C 降级语义）──────────
// localStorage["juya-last-parse"]：解析作业状态化后，运行态一律以服务端 parse 字段为准；
// 此缓存只存终态快照（done/failed），仅在服务端报 idle / 未交付 parse 字段时兜底展示。

export interface LastParseRecord {
  at: string; // 本地 "MM-DD HH:mm"（写入时格式化，不做时区换算）
  status: "done" | "failed"; // 缓存只存终态
  processed: number;
  total: number;
  remaining: number;
  errors: string[];
}

const STORAGE_KEY = "juya-last-parse";

function fmtLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 挂载时读缓存（静态导出首帧无 window，只在 effect 里调）。兼容 spec12 旧形状
 *  （无 status/total、含 candidatesFound/skipped）：按可还原字段归一为 done 快照。 */
export function loadLastParse(): LastParseRecord | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<LastParseRecord> & { processed?: number };
    return {
      at: typeof p.at === "string" ? p.at : "",
      status: p.status === "failed" ? "failed" : "done",
      processed: typeof p.processed === "number" ? p.processed : 0,
      total: typeof p.total === "number" ? p.total : (typeof p.processed === "number" ? p.processed : 0),
      remaining: typeof p.remaining === "number" ? p.remaining : 0,
      errors: Array.isArray(p.errors) ? p.errors : [],
    };
  } catch {
    return null; // 损坏 JSON / 存储不可达：视同无记录
  }
}

/** 轮询捕获终态时写缓存（spec13 契约 C：「最近一次我看到的响应」），返回记录供兜底展示 */
export function saveLastParse(state: ParseStatePayload): LastParseRecord {
  const rec: LastParseRecord = {
    at: fmtLocal(new Date()),
    status: state.status === "failed" ? "failed" : "done",
    processed: state.processed ?? 0,
    total: state.total ?? 0,
    remaining: state.remaining ?? 0,
    errors: state.errors,
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rec));
  } catch {
    // 存储不可达（隐私模式/配额）：仅影响兜底展示，不阻塞解析流程
  }
  return rec;
}

// worker 实际交付 "itemId: 原因" 字符串清单——展示层换分隔符
function errorLine(err: string): string {
  return err.replace(": ", " · ");
}

/** 服务端时间字符串 → 展示用 "MM-DD HH:mm"（兼容 ISO 与 UTC naive，直接截取不做时区换算） */
function fmtStamp(s: string): string {
  return s.replace("T", " ").slice(5, 16);
}

/** 服务端时间字符串 → 毫秒（兼容 ISO 与 UTC naive「YYYY-MM-DD HH:MM:SS」——后者按 UTC 解析） */
function parseServerTimeMs(s: string): number {
  return Date.parse(s.includes("T") ? s : `${s.replace(" ", "T")}Z`);
}

/** 已用时长 sec → "MM:SS"（超 1 小时 "H:MM:SS"） */
function fmtElapsed(sec: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

/** 本地瞬态：POST 启动中 / POST 本身失败（网络、口令）——与服务端作业 failed 区分 */
export type PostPhase = "idle" | "starting" | "fail";

interface Props {
  /** 服务端解析作业状态（spec13 契约 C，运行态以此为准）；旧 worker 未交付时为 null */
  state: ParseStatePayload | null;
  postPhase: PostPhase;
  /** POST 本身失败提示（网络/口令） */
  postErrMsg: string;
  /** 409 提示（另一处已在运行解析，已接入进度）——运行中行内展示 */
  busyHint: string;
  /** 服务端 idle / 未交付 parse 字段时的兜底缓存 */
  last: LastParseRecord | null;
  onRun: () => void;
}

/** 解析区（spec12 契约 C + spec13 契约 F）：运行态=进度行（k/M + 已用时长 + 呼吸点标）；
 *  服务端 failed=朱橙显原因；done=完成摘要 + 逐条失败；idle/缺字段=兜底缓存。
 *  根节点挂 id="review-parse"（数据流标头②段滚动锚点）。 */
export function ParsePanel({ state, postPhase, postErrMsg, busyHint, last, onRun }: Props) {
  const running = state?.status === "running" || postPhase === "starting";
  return (
    <div id="review-parse">
      {running ? (
        <RunningRow state={state} hint={busyHint} />
      ) : state?.status === "failed" ? (
        <FailedRow state={state} onRun={onRun} />
      ) : postPhase === "fail" ? (
        <PostFailRow msg={postErrMsg} onRun={onRun} />
      ) : state?.status === "done" ? (
        <DoneRow state={state} onRun={onRun} />
      ) : last ? (
        <CacheRow last={last} onRun={onRun} />
      ) : null}
    </div>
  );
}

/** 运行中进度行：呼吸点标 + k/M + 已用时长（startedAt 起算，前端时钟差容忍：负值截 0），每秒走字。
 *  state 为 null = POST 启动中尚未拿到快照，先显「解析中…」。 */
function RunningRow({ state, hint }: { state: ParseStatePayload | null; hint: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const startedMs = state?.startedAt ? parseServerTimeMs(state.startedAt) : null;
  const elapsedSec = startedMs === null ? null : Math.max(0, Math.floor((now - startedMs) / 1000));
  return (
    <div className="rule-t mt-3">
      <div
        className="max-w-6xl mx-auto px-5 py-1.5 text-xs flex flex-col gap-1"
        style={{ color: "var(--fg-muted)", fontVariantNumeric: "tabular-nums" }}
        role="status"
        aria-busy="true"
      >
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span aria-hidden className="breath-dot shrink-0" style={{ color: "var(--fg)" }}>
            ●
          </span>
          <span className="shrink-0">
            {state ? `解析中 ${state.processed ?? 0}/${state.total ?? 0}` : "解析中…"}
          </span>
          {elapsedSec !== null && <span className="shrink-0">已用 {fmtElapsed(elapsedSec)}</span>}
          <span className="shrink-0">（LLM 逐条判主次，刷新页面进度不丢）</span>
        </div>
        {hint && (
          <div className="min-w-0 truncate" title={hint}>
            {hint}
          </div>
        )}
      </div>
    </div>
  );
}

/** 服务端作业失败：朱橙显原因（首条原因 + 余下清单）+ 重试 */
function FailedRow({ state, onRun }: { state: ParseStatePayload; onRun: () => void }) {
  const reason = state.errors.length > 0 ? errorLine(state.errors[0]) : "解析作业异常";
  return (
    <div className="rule-t mt-3">
      <div className="max-w-6xl mx-auto px-5 py-1.5 text-xs" role="alert">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span aria-hidden className="shrink-0" style={{ color: "var(--accent)" }}>
            ●
          </span>
          <span className="shrink-0" style={{ color: "var(--accent)" }}>
            解析失败
          </span>
          <span className="min-w-0 truncate" style={{ color: "var(--accent)" }} title={reason}>
            {reason}
          </span>
          <button type="button" className="text-link shrink-0" onClick={onRun}>
            重试
          </button>
        </div>
        {state.errors.length > 1 && (
          <ul className="mt-1 min-w-0" style={{ color: "var(--accent)" }}>
            {state.errors.slice(1).map((e, i) => (
              <li key={i} className="truncate" title={e}>
                {errorLine(e)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** POST 本身失败（网络/口令）：沿用既有灰字 + 重试语言（与服务端 failed 的朱橙区分） */
function PostFailRow({ msg, onRun }: { msg: string; onRun: () => void }) {
  return (
    <div className="rule-t mt-3">
      <div className="max-w-6xl mx-auto px-5 py-1.5 text-xs flex items-center gap-2 min-w-0" style={{ color: "var(--fg-muted)" }} role="status">
        <span className="min-w-0 truncate">{msg}</span>
        <button type="button" className="text-link shrink-0" onClick={onRun}>
          重试
        </button>
      </div>
    </div>
  );
}

/** 服务端 done 摘要：处理 k/M + 余量 + 逐条失败（朱橙）；仍有失败或余量 → 再跑一次（解析幂等只补漏） */
function DoneRow({ state, onRun }: { state: ParseStatePayload; onRun: () => void }) {
  const needRerun = (state.remaining ?? 0) > 0 || state.errors.length > 0;
  return (
    <div className="rule-t mt-3">
      <div className="max-w-6xl mx-auto px-5 py-1.5 text-xs min-w-0" role="status">
        <div className="flex items-center gap-2 flex-wrap min-w-0" style={{ color: "var(--fg-muted)", fontVariantNumeric: "tabular-nums" }}>
          <span aria-hidden className="shrink-0" style={{ color: "var(--accent)" }}>
            ●
          </span>
          <span className="shrink-0">解析已完成</span>
          {state.finishedAt && (
            <span className="shrink-0" title="完成时间（UTC）">
              {fmtStamp(state.finishedAt)}
            </span>
          )}
          <span className="shrink-0">
            处理 {state.processed ?? 0}/{state.total ?? 0}
          </span>
          <span className="shrink-0">余量 {state.remaining ?? 0}</span>
          {state.errors.length > 0 && (
            <span className="shrink-0" style={{ color: "var(--accent)" }}>
              失败 {state.errors.length}
            </span>
          )}
        </div>
        {state.errors.length > 0 && (
          <ul className="mt-1 min-w-0" style={{ color: "var(--accent)" }}>
            {state.errors.map((e, i) => (
              <li key={i} className="truncate" title={e}>
                {errorLine(e)}
              </li>
            ))}
          </ul>
        )}
        {needRerun && (
          <div className="mt-1 flex items-center gap-2" style={{ color: "var(--fg-muted)" }}>
            <span>仍有失败或余量——解析幂等只补漏，</span>
            <button type="button" className="text-link" onClick={onRun}>
              再跑一次
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** 兜底缓存行（服务端 idle / 未交付 parse 字段时）：文案标明「上次解析」与缓存语义（spec13 降级） */
function CacheRow({ last, onRun }: { last: LastParseRecord; onRun: () => void }) {
  const needRerun = last.errors.length > 0 || last.remaining > 0;
  return (
    <div className="rule-t mt-3">
      <div className="max-w-6xl mx-auto px-5 py-1.5 text-xs min-w-0" role="status">
        <div className="flex items-center gap-2 flex-wrap min-w-0" style={{ color: "var(--fg-muted)", fontVariantNumeric: "tabular-nums" }}>
          <span aria-hidden className="shrink-0" style={{ color: "var(--accent)" }}>
            ●
          </span>
          <span className="shrink-0" title="本机缓存（运行态以服务端解析状态为准）">
            上次解析 {last.at}
          </span>
          <span className="shrink-0">{last.status === "failed" ? "失败" : `处理 ${last.processed}/${last.total}`}</span>
          <span className="shrink-0">余量 {last.remaining}</span>
          {last.errors.length > 0 && (
            <span className="shrink-0" style={{ color: "var(--accent)" }}>
              失败 {last.errors.length}
            </span>
          )}
        </div>
        {last.errors.length > 0 && (
          <ul className="mt-1 min-w-0" style={{ color: "var(--accent)" }}>
            {last.errors.map((e, i) => (
              <li key={i} className="truncate" title={e}>
                {errorLine(e)}
              </li>
            ))}
          </ul>
        )}
        {needRerun && (
          <div className="mt-1 flex items-center gap-2" style={{ color: "var(--fg-muted)" }}>
            <span>仍有失败或余量——解析幂等只补漏，</span>
            <button type="button" className="text-link" onClick={onRun}>
              再跑一次
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

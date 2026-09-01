"use client";

import { ParseOutcome } from "@/lib/api";

// ── 最近一次解析结果的本地持久化（spec12 契约 C）──────────────────────────
// localStorage["juya-last-parse"]：解析响应整体 + 本地时间戳。审核是单管理员本机动作，
// 无需服务端持久化；新响应整体覆盖旧值，错误清单随之消失（解析成功清零后自然不见）。

export interface LastParseRecord {
  at: string; // 本地 "MM-DD HH:mm"（保存时格式化，不做时区换算）
  processed: number; // 本次成功条数
  candidatesFound: number; // 本次落库的候选数
  remaining: number; // 圈题池余量（含截断与单条失败）
  skipped: number; // 单条 LLM 失败数
  errors: string[]; // "itemId: 原因" 清单（截断）
}

const STORAGE_KEY = "juya-last-parse";

function fmtLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 挂载时读最近一次解析结果（静态导出首帧无 window，只在 effect 里调） */
export function loadLastParse(): LastParseRecord | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LastParseRecord;
  } catch {
    return null; // 损坏 JSON / 存储不可达：视同无记录
  }
}

/** 解析成功后整体落 localStorage（spec12 契约 C），返回记录供 ParsePanel 常驻展示 */
export function saveLastParse(res: ParseOutcome): LastParseRecord {
  const rec: LastParseRecord = {
    at: fmtLocal(new Date()),
    processed: res.processed,
    candidatesFound: res.candidatesFound,
    remaining: res.remaining,
    skipped: res.skipped,
    errors: res.errors,
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rec));
  } catch {
    // 存储不可达（隐私模式/配额）：仅影响常驻展示，不阻塞解析流程
  }
  return rec;
}

// worker 实际交付 "itemId: 原因" 字符串清单（契约 C 的对象形状未交付）——展示层换分隔符
function errorLine(err: string): string {
  return err.replace(": ", " · ");
}

export type ParsePhase = "idle" | "running" | "fail";

interface Props {
  /** 最近一次解析结果（localStorage 持久，页面常驻展示） */
  last: LastParseRecord | null;
  phase: ParsePhase;
  /** 失败提示（网络/口令） */
  failMsg: string;
  onRun: () => void;
}

/** 解析区（spec12 契约 C）：常驻展示最近一次解析结果——时间 + 成功/候选/余量 + 逐条失败
 *  「itemId · 原因」（朱橙）；余量或失败非零 →「再跑一次」提示（解析幂等只补漏）。 */
export function ParsePanel({ last, phase, failMsg, onRun }: Props) {
  if (phase === "running") {
    return (
      <div className="rule-t mt-3">
        <div className="max-w-6xl mx-auto px-5 py-1.5 text-xs flex items-center gap-2" style={{ color: "var(--fg-muted)" }} role="status" aria-busy="true">
          <span>解析中…（LLM 逐条判主次，可能要等一会儿）</span>
        </div>
      </div>
    );
  }
  if (phase === "fail") {
    return (
      <div className="rule-t mt-3">
        <div className="max-w-6xl mx-auto px-5 py-1.5 text-xs flex items-center gap-2 min-w-0" style={{ color: "var(--fg-muted)" }} role="status">
          <span className="min-w-0 truncate">{failMsg}</span>
          <button type="button" className="text-link shrink-0" onClick={onRun}>
            重试
          </button>
        </div>
      </div>
    );
  }
  if (last === null) return null;

  const needRerun = last.errors.length > 0 || last.remaining > 0;
  return (
    <div className="rule-t mt-3">
      <div className="max-w-6xl mx-auto px-5 py-1.5 text-xs min-w-0" role="status">
        <div className="flex items-center gap-2 flex-wrap min-w-0" style={{ color: "var(--fg-muted)", fontVariantNumeric: "tabular-nums" }}>
          <span aria-hidden className="shrink-0" style={{ color: "var(--accent)" }}>
            ●
          </span>
          <span className="shrink-0">最近解析 {last.at}</span>
          <span className="shrink-0">成功 {last.processed} 条</span>
          <span className="shrink-0">候选 {last.candidatesFound} 个</span>
          <span className="shrink-0">余量 {last.remaining}</span>
          {last.skipped > 0 && (
            <span className="shrink-0" style={{ color: "var(--accent)" }}>
              失败 {last.skipped}
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

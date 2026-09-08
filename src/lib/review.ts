// 审核台纯函数（spec12 契约 B + spec13 票 02 + spec14 票 02）：暂存条目三态分组、
// 今日流水线卡三段行文案、待办 tab 归并、解析作业轮询决策。UI 渲染序 = 组序（unparsed → parsed → noNeed）。
// 数据形状以 src/lib/api.ts 为准；不掺 fetch / DOM，保持可测。
import { LastParseRecord } from "@/components/review/last-parse";
import { ParseJobStatus, ParseStatePayload, PendingItem, ReviewHistory, SyncRun } from "./api";

export interface CategorizedPending {
  /** 待解析（缺建议，机器可跑）：多家命中无 proposal，或 missing_owner 且候选未提议 */
  unparsed: PendingItem[];
  /** 缺候选待入册（spec12 走查补正）：missing_owner 且候选已提议——公司入册前机器无事可做，等人工 */
  blocked: PendingItem[];
  /** 已解析待确认：多家命中且有 proposal（llmModel='human-edit' = 人工编辑终版） */
  parsed: PendingItem[];
  /** 无需解析：其余（单家归属等，publish 按当前归属直接入库） */
  noNeed: PendingItem[];
}

/** missing_owner 判定：enrichState 带 missing_owner 即是；/api/review/pending 尚未返回该字段时
 *  兜底 = 无现归属且无 proposal（missing_owner 条目在库中必然无 item_companies 行，
 *  而有 proposal 的条目 enrich_state 必已置 ok——见 worker parse.ts applyProposalStatements）。 */
export function isMissingOwner(item: PendingItem): boolean {
  if (item.enrichState === "missing_owner") return true;
  if (item.enrichState !== undefined) return false;
  return item.owners.length === 0 && item.proposal === null;
}

/** 三态分组（spec12 契约 B，组序即渲染序）：
 *  1. 待解析 = owners≥2 且无 proposal，或 missing_owner
 *  2. 已解析待确认 = owners≥2 且有 proposal
 *  3. 无需解析 = 其余（单家归属等） */
/** 四态分组（spec12 契约 B + 走查补正，组序即渲染序）：
 *  1. 待解析 = owners≥2 且无 proposal，或 missing_owner 且候选未提议（机器可跑）
 *  2. 缺候选待入册 = missing_owner 且候选已提议（等人工入册，20260902-6/-14 实测）
 *  3. 已解析待确认 = owners≥2 且有 proposal
 *  4. 无需解析 = 其余（单家归属等） */
export function categorizePending(items: PendingItem[]): CategorizedPending {
  const out: CategorizedPending = { unparsed: [], blocked: [], parsed: [], noNeed: [] };
  for (const it of items) {
    if (isMissingOwner(it)) {
      (it.candidate !== null ? out.blocked : out.unparsed).push(it);
    } else if (it.owners.length >= 2) {
      (it.proposal !== null ? out.parsed : out.unparsed).push(it);
    } else {
      out.noNeed.push(it);
    }
  }
  return out;
}

// ═══════════ spec13 票 02：轮询决策（契约 D）══════════

/** 轮询决策（spec13 契约 D）：仅 running 需要每 3s 轮询 pending；parse 字段缺失视同 idle 不轮询 */
export function shouldPollParse(parse: ParseStatePayload | null | undefined): boolean {
  return parse?.status === "running";
}

/** 停轮询时是否补拉一次数据（spec13 契约 D/F）：仅「轮询中 → 终态」的转换需要。
 *  done 且 processed>0 才补拉（新建议落地，空跑不重拉）；failed 补拉一次对账；
 *  首挂载即终态不补拉（挂载 loadPending 已取最新）。 */
export function parsePollStopRefresh(
  prev: ParseJobStatus | null | undefined,
  next: ParseStatePayload | null | undefined
): boolean {
  if (prev !== "running") return false;
  if (next?.status === "failed") return true;
  return next?.status === "done" && (next.processed ?? 0) > 0;
}

// ═══════════ spec14 票 02：今日流水线卡三段行（契约 C）══════════

/** 今日卡段落行：text = 拼装文案；tone 决定配色/点标语言（ink=常态墨色 / pulse=运行中呼吸点标 / accent=朱橙警示） */
export interface FlowCardRow {
  tone: "ink" | "pulse" | "accent";
  text: string;
}

/** 服务端时间字符串 → "MM-DD HH:mm"（兼容 ISO 与 UTC naive，直接截取不做时区换算；异常 null → "—"） */
function stampOf(s: string | null): string {
  return s === null ? "—" : s.replace("T", " ").slice(5, 16);
}

/** errors 字符串（"itemId: 原因"）→ 展示分隔（与既有错误行同语言） */
function errorLine(err: string): string {
  return err.replace(": ", " · ");
}

/** 今日卡①行：最新一次 sync_runs 摘要（spec14 契约 C）。
 *  同步中显「同步中…」（pulse，优先于任何记录）；无记录「尚未同步」；
 *  有记录 = 时间 · 窗口 N 期 · 新增/更新/未变化（0 值段省略）· 耗时（<0.1s 省略）；
 *  失败记录（ok=false）朱橙（accent）：失败 X + 首条原因。 */
function syncRow(latest: SyncRun | null, syncing: boolean): FlowCardRow {
  if (syncing) return { tone: "pulse", text: "同步中…" };
  if (latest === null) return { tone: "ink", text: "尚未同步" };
  const parts: string[] = [stampOf(latest.startedAt), `窗口 ${latest.windowDates.length} 期`];
  if (latest.ok) {
    if (latest.added.length > 0) parts.push(`新增 ${latest.added.length}`);
    if (latest.updated.length > 0) parts.push(`更新 ${latest.updated.length}`);
    if (latest.unchanged.length > 0) parts.push(`未变化 ${latest.unchanged.length}`);
  } else {
    parts.push(`失败 ${latest.failures.length}`);
    if (latest.failures.length > 0) parts.push(latest.failures[0].error);
    return { tone: "accent", text: parts.join(" · ") };
  }
  const sec = latest.durationMs === null ? null : latest.durationMs / 1000;
  if (sec !== null && sec >= 0.1) parts.push(`耗时 ${sec.toFixed(1)}s`);
  return { tone: "ink", text: parts.join(" · ") };
}

/** 今日卡②行：解析状态摘要（spec14 契约 C）。
 *  running「运行中 k/M」+呼吸点标（total 未写入不显 0/0）/ done「<完成时间> 已完成 · 处理 n/m」/
 *  failed 朱橙「失败 · 首条原因」/ idle：终态缓存兜底「上次解析 …」，无缓存「空闲」。 */
function parseRow(parse: ParseStatePayload | null | undefined, last: LastParseRecord | null): FlowCardRow {
  if (parse?.status === "running") {
    const total = parse.total ?? 0;
    const processed = parse.processed ?? 0;
    return { tone: "pulse", text: total > 0 ? `运行中 ${processed}/${total}` : "运行中" };
  }
  if (parse?.status === "done") {
    const head = parse.finishedAt ? `${stampOf(parse.finishedAt)} ` : "";
    return { tone: "ink", text: `${head}已完成 · 处理 ${parse.processed ?? 0}/${parse.total ?? 0}` };
  }
  if (parse?.status === "failed") {
    const first = parse.errors.length > 0 ? ` · ${errorLine(parse.errors[0])}` : "";
    return { tone: "accent", text: `失败${first}` };
  }
  if (last !== null) {
    const body = last.status === "failed" ? "失败" : `处理 ${last.processed}/${last.total}`;
    return { tone: "ink", text: `上次解析 ${last.at} · ${body}` };
  }
  return { tone: "ink", text: "空闲" };
}

/** 今日卡③行：已入库汇总（spec14 契约 C）：published>0 过滤 →「至 <max date> · 共 X 期 Y 条」；空 →「暂无入库」 */
function publishedRow(history: ReviewHistory[]): FlowCardRow {
  let issues = 0;
  let items = 0;
  let maxDate = "";
  for (const row of history) {
    if (row.published > 0) {
      issues += 1;
      items += row.published;
      if (row.date > maxDate) maxDate = row.date;
    }
  }
  if (issues === 0) return { tone: "ink", text: "暂无入库" };
  return { tone: "ink", text: `至 ${maxDate} · 共 ${issues} 期 ${items} 条` };
}

/** 今日流水线卡三段行文案（spec14 契约 C，先红后绿）：① 同步 / ② 解析 / ③ 已入库。
 *  FlowCard 组件只消费本函数产出渲染，文案变更改这里。 */
export function flowCardRows(
  latest: SyncRun | null,
  parse: ParseStatePayload | null | undefined,
  lastParse: LastParseRecord | null,
  history: ReviewHistory[],
  syncing = false
): { sync: FlowCardRow; parse: FlowCardRow; published: FlowCardRow } {
  return {
    sync: syncRow(latest, syncing),
    parse: parseRow(parse, lastParse),
    published: publishedRow(history),
  };
}

// ═══════════ spec14 票 02：待办 tab（契约 D）══════════

export type TodoTabKey = "todo" | "blocked" | "issues";

/** 异常 tab 摘要行：parse.errors 字符串（"itemId: 原因"）拆解为「itemId · 原因」行 */
export interface TodoIssueRow {
  itemId: string;
  reason: string;
}

/** 待办 tab（spec14 契约 D）：三 tab——待审核（parsed+noNeed 合并）/ 缺候选待入册（blocked）/ 异常（parse.errors 摘要行）。
 *  tab 固定按 todo → blocked → issues 序返回（渲染序）；计数 = 各 tab 行数。 */
export interface TodoTab {
  key: TodoTabKey;
  label: string;
  count: number;
  /** 待审核/缺候选 tab 的条目体（异常 tab 恒为空，只列摘要行） */
  items: PendingItem[];
  /** 异常 tab 摘要行（其余 tab 恒为空） */
  errors: TodoIssueRow[];
}

/** 待办 tab 归并（spec14 契约 D，先红后绿）：待审核 = parsed + noNeed 合并（parsed 在前，各自保持原相对序）；
 *  异常 tab 行 = parse.errors 逐条「itemId · 原因」（无冒号的整行视作原因）。 */
export function todoTabs(groups: CategorizedPending, parseErrors: string[]): TodoTab[] {
  const issueRows: TodoIssueRow[] = parseErrors.map((e) => {
    const idx = e.indexOf(":");
    return idx === -1 ? { itemId: "", reason: e } : { itemId: e.slice(0, idx), reason: e.slice(idx + 1).trim() };
  });
  return [
    { key: "todo", label: "待审核", count: groups.parsed.length + groups.noNeed.length, items: [...groups.parsed, ...groups.noNeed], errors: [] },
    { key: "blocked", label: "缺候选待入册", count: groups.blocked.length, items: groups.blocked, errors: [] },
    { key: "issues", label: "异常", count: issueRows.length, items: [], errors: issueRows },
  ];
}

/** tab 默认落点（spec14 契约 D）：第一个 count>0 的 key；全空 → 待审核（todo）。
 *  counts 按 todo → blocked → issues 序传入（todoTabs 产出序）。 */
export function defaultTodoTab(counts: [number, number, number]): TodoTabKey {
  if (counts[0] > 0) return "todo";
  if (counts[1] > 0) return "blocked";
  if (counts[2] > 0) return "issues";
  return "todo";
}

// 审核台纯函数（spec12 契约 B + spec13 票 02）：暂存条目三态分组、数据流标头三段计数、
// 解析作业轮询决策。UI 渲染序 = 组序（unparsed → parsed → noNeed）。
// 数据形状以 src/lib/api.ts 为准；不掺 fetch / DOM，保持可测。
import { ParseJobStatus, ParseStatePayload, PendingItem, ReviewHistory } from "./api";

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

// ═══════════ spec13 票 02：数据流标头（契约 E）+ 轮询决策（契约 D）══════════

/** 数据流标头段落数据：tone 决定点标/配色语言（ink=常态墨色 / pulse=运行中呼吸点标 / accent=朱橙警示） */
export interface FlowSegment {
  tone: "ink" | "pulse" | "accent";
  /** 段落文案（含计数，如「已同步 · 暂存 3 条」） */
  label: string;
}

/** 数据流标头三段计数（spec13 契约 E）：暂存条目数 / 解析作业状态 / 同步历史 → 三段流水线文案。
 *  ② 段 parse 字段缺失（旧 worker 未交付）视同 idle；③ 段仅统计 published>0 的期（期数 X、条数 Y=Σpublished）。 */
export function flowCounts(
  staged: number,
  parse: ParseStatePayload | null | undefined,
  history: ReviewHistory[]
): { sync: FlowSegment; parse: FlowSegment; published: FlowSegment } {
  let parseSeg: FlowSegment;
  if (parse?.status === "running") {
    // 刚起跑 total 尚未写入时不显 0/0；idle 计数为 null（spec13 契约 C），容错按 0
    const total = parse.total ?? 0;
    const processed = parse.processed ?? 0;
    parseSeg = { tone: "pulse", label: total > 0 ? `解析 · 运行中 ${processed}/${total}` : "解析 · 运行中" };
  } else if (parse?.status === "done") {
    parseSeg = { tone: "ink", label: "解析 · 已完成" };
  } else if (parse?.status === "failed") {
    parseSeg = { tone: "accent", label: "解析 · 失败" };
  } else {
    parseSeg = { tone: "ink", label: "解析 · 空闲" };
  }
  let issues = 0;
  let items = 0;
  for (const row of history) {
    if (row.published > 0) {
      issues += 1;
      items += row.published;
    }
  }
  return {
    sync: { tone: "ink", label: `已同步 · 暂存 ${staged} 条` },
    parse: parseSeg,
    published: { tone: "ink", label: `已入库 · ${issues} 期 ${items} 条` },
  };
}

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

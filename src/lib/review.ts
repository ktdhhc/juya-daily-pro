// 审核台纯函数（spec12 契约 B）：暂存条目三态分组。UI 渲染序 = 组序（unparsed → parsed → noNeed）。
// 数据形状以 src/lib/api.ts PendingItem 为准；不掺 fetch / DOM，保持可测。
import { PendingItem } from "./api";

export interface CategorizedPending {
  /** 待解析（缺建议）：多家命中无 proposal，或 missing_owner（缺归属，候选待入册） */
  unparsed: PendingItem[];
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
export function categorizePending(items: PendingItem[]): CategorizedPending {
  const out: CategorizedPending = { unparsed: [], parsed: [], noNeed: [] };
  for (const it of items) {
    if (isMissingOwner(it)) {
      out.unparsed.push(it);
    } else if (it.owners.length >= 2) {
      (it.proposal !== null ? out.parsed : out.unparsed).push(it);
    } else {
      out.noNeed.push(it);
    }
  }
  return out;
}

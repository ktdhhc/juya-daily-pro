// match — spec03 Step 4.1：段一匹配的纯编排（ADR-0011 只测纯函数，无 fetch/fs/进程）。
// 对每条 Item 调 ownersByMatching（src/lib/matchCompanies.ts 段一匹配器），聚合为
// 写库所需结构：ownerRows（item_companies 行，role 由 SQL 恒置 NULL）、
// okIds / missingIds（items.enrich_state 回写分档，ADR-0008）。
import { ownersByMatching } from "../../src/lib/matchCompanies";
import type { Company, Item } from "../../src/lib/schema";

// Item 仅需 id + 段一匹配字段（title/bodyMd）；完整 Item 亦兼容。
export type MatchItem = Pick<Item, "id" | "title" | "bodyMd">;

export interface MatchAllResult {
  ownerRows: { itemId: string; companyId: string }[];
  okIds: string[];
  missingIds: string[];
}

export function matchAll(items: MatchItem[], registry: Company[]): MatchAllResult {
  const ownerRows: { itemId: string; companyId: string }[] = [];
  const okIds: string[] = [];
  const missingIds: string[] = [];
  for (const item of items) {
    const owners = ownersByMatching(item, registry);
    if (owners.length === 0) {
      missingIds.push(item.id);
      continue;
    }
    okIds.push(item.id);
    for (const owner of owners) {
      ownerRows.push({ itemId: item.id, companyId: owner.company });
    }
  }
  return { ownerRows, okIds, missingIds };
}

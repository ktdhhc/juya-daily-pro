// review.ts TDD 测试（spec12 票 02）：categorizePending 三态分组纯函数。
// 覆盖：三态各一例 / missing_owner 归待解析（含 enrichState 未返回的兜底）/ 组序 unparsed→parsed→noNeed。
import { describe, expect, it } from "vitest";
import { PendingItem } from "./api";
import { categorizePending } from "./review";

/** 造数：只填 id/owners/proposal/enrichState，其余字段给空缺省（形状对齐 src/lib/api.ts PendingItem） */
function item(partial: Pick<PendingItem, "id"> & Partial<PendingItem>): PendingItem {
  return {
    title: "",
    summary: "",
    category: "",
    tag: "",
    owners: [],
    proposal: null,
    candidate: null,
    ...partial,
  };
}

const PROPOSAL = { owners: [{ companyId: "a", role: "primary" as const }], llmModel: "gpt-x" };

describe("categorizePending（spec12 审核台三态分组）", () => {
  it("1. 多家命中无建议 → 待解析（unparsed）", () => {
    const it2owners = item({
      id: "20260901-1",
      owners: [
        { companyId: "a", name: "A", color: "#111111", role: null },
        { companyId: "b", name: "B", color: "#222222", role: null },
      ],
    });
    expect(categorizePending([it2owners])).toEqual({
      unparsed: [it2owners],
      parsed: [],
      noNeed: [],
    });
  });

  it("2. 多家命中且有 proposal → 已解析待确认（parsed）", () => {
    const decided = item({
      id: "20260901-2",
      owners: [
        { companyId: "a", name: "A", color: "#111111", role: "primary" },
        { companyId: "b", name: "B", color: "#222222", role: "partner" },
      ],
      proposal: PROPOSAL,
    });
    expect(categorizePending([decided])).toEqual({
      unparsed: [],
      parsed: [decided],
      noNeed: [],
    });
  });

  it("3. 单家归属（无 proposal）→ 无需解析（noNeed）", () => {
    const single = item({
      id: "20260901-3",
      owners: [{ companyId: "a", name: "A", color: "#111111", role: null }],
    });
    expect(categorizePending([single])).toEqual({
      unparsed: [],
      parsed: [],
      noNeed: [single],
    });
  });

  it("4. missing_owner 归待解析；enrichState 未返回时 owners 空 + 无 proposal 兜底同样归待解析", () => {
    const marked = item({ id: "20260901-4", enrichState: "missing_owner" });
    const fallback = item({ id: "20260901-5" }); // /api/review/pending 未带 enrichState（契约差异，见 api.ts 注）
    expect(categorizePending([marked, fallback])).toEqual({
      unparsed: [marked, fallback],
      parsed: [],
      noNeed: [],
    });
  });

  it("5. 组序与分拣：混合输入按 unparsed→parsed→noNeed 分组，不丢不重", () => {
    const unparsedItem = item({
      id: "20260901-6",
      owners: [
        { companyId: "a", name: "A", color: "#111111", role: null },
        { companyId: "b", name: "B", color: "#222222", role: null },
      ],
    });
    const parsedItem = item({
      id: "20260901-7",
      owners: [
        { companyId: "a", name: "A", color: "#111111", role: "primary" },
        { companyId: "b", name: "B", color: "#222222", role: "partner" },
      ],
      proposal: PROPOSAL,
    });
    const noNeedItem = item({
      id: "20260901-8",
      owners: [{ companyId: "c", name: "C", color: "#333333", role: null }],
    });
    const out = categorizePending([parsedItem, noNeedItem, unparsedItem]);
    expect(Object.keys(out)).toEqual(["unparsed", "parsed", "noNeed"]);
    expect(out).toEqual({
      unparsed: [unparsedItem],
      parsed: [parsedItem],
      noNeed: [noNeedItem],
    });
  });
});

// review.ts TDD 测试（spec12 票 02 + spec13 票 02）：categorizePending 三态分组、
// flowCounts 数据流标头三段计数、shouldPollParse / parsePollStopRefresh 轮询决策纯函数。
// 覆盖：三态各一例 / missing_owner 归待解析（含 enrichState 未返回的兜底）/ 组序 unparsed→parsed→noNeed；
// spec13：running/idle/done/failed 四态文案与点标 tone、published>0 过滤、轮询启停与终态补拉。
import { describe, expect, it } from "vitest";
import { ParseJobStatus, ParseStatePayload, PendingItem, ReviewHistory } from "./api";
import { categorizePending, flowCounts, parsePollStopRefresh, shouldPollParse } from "./review";

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
      blocked: [],
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
      blocked: [],
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
      blocked: [],
      parsed: [],
      noNeed: [single],
    });
  });

  it("4. missing_owner 归待解析；enrichState 未返回时 owners 空 + 无 proposal 兜底同样归待解析", () => {
    const marked = item({ id: "20260901-4", enrichState: "missing_owner" });
    const fallback = item({ id: "20260901-5" }); // /api/review/pending 未带 enrichState（契约差异，见 api.ts 注）
    expect(categorizePending([marked, fallback])).toEqual({
      unparsed: [marked, fallback],
      blocked: [],
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
    expect(Object.keys(out)).toEqual(["unparsed", "blocked", "parsed", "noNeed"]);
    expect(out).toEqual({
      unparsed: [unparsedItem],
      blocked: [],
      parsed: [parsedItem],
      noNeed: [noNeedItem],
    });
  });

  it("6. missing_owner 且候选已提议 → blocked（缺候选待入册，等人工）；未提议 → unparsed（机器可跑）", () => {
    const blockedItem = item({
      id: "20260902-6",
      enrichState: "missing_owner",
      candidate: { id: "runway", name: "Runway", aliases: ["Runway"], confidence: "high", reason: "新闻主角" },
    });
    const unparsedMissing = item({ id: "20260901-4", enrichState: "missing_owner" });
    const out = categorizePending([blockedItem, unparsedMissing]);
    expect(out.blocked).toEqual([blockedItem]);
    expect(out.unparsed).toEqual([unparsedMissing]);
  });
});

// ═══════════ spec13 票 02：数据流标头 + 轮询决策（先红后绿）═══════════

/** 造数：ParseStatePayload（spec13 契约 C 形状），缺省零值 */
function parseState(partial: Partial<ParseStatePayload> & { status: ParseJobStatus }): ParseStatePayload {
  return { startedAt: null, finishedAt: null, processed: 0, total: 0, remaining: 0, errors: [], ...partial };
}

/** 造数：ReviewHistory 行（flowCounts 只消费 published 统计，其余字段给固定缺省） */
function historyRow(date: string, items: number, published: number): ReviewHistory {
  return { date, status: "ok", error: null, attemptedAt: "2026-08-30 10:00:00", items, published, attributed: 0 };
}

describe("flowCounts（spec13 数据流标头三段计数）", () => {
  it("1. running 态：② 段 tone=pulse（呼吸点标），文案「解析 · 运行中 k/M」；① 段暂存计数", () => {
    const out = flowCounts(3, parseState({ status: "running", processed: 4, total: 12 }), []);
    expect(out.parse).toEqual({ tone: "pulse", label: "解析 · 运行中 4/12" });
    expect(out.sync).toEqual({ tone: "ink", label: "已同步 · 暂存 3 条" });
    expect(out.published).toEqual({ tone: "ink", label: "已入库 · 0 期 0 条" });
  });

  it("2. idle 与 parse 字段缺失（旧 worker 未交付）同视：② 段「解析 · 空闲」不崩（含 worker 实际交付的计数全 null idle 形状）", () => {
    expect(flowCounts(0, parseState({ status: "idle" }), []).parse).toEqual({ tone: "ink", label: "解析 · 空闲" });
    expect(flowCounts(0, parseState({ status: "idle", processed: null, total: null, remaining: null }), []).parse).toEqual({
      tone: "ink",
      label: "解析 · 空闲",
    });
    expect(flowCounts(0, null, []).parse).toEqual({ tone: "ink", label: "解析 · 空闲" });
  });

  it("3. done →「解析 · 已完成」（ink）；failed → 朱橙（tone=accent）「解析 · 失败」", () => {
    expect(flowCounts(0, parseState({ status: "done", processed: 5, total: 5 }), []).parse).toEqual({
      tone: "ink",
      label: "解析 · 已完成",
    });
    expect(flowCounts(0, parseState({ status: "failed", errors: ["job boom"] }), []).parse).toEqual({
      tone: "accent",
      label: "解析 · 失败",
    });
  });

  it("4. published 过滤：仅 published>0 的期计入 ③ 段（期数 X、条数 Y=Σpublished）", () => {
    const history = [
      historyRow("2026-08-28", 5, 5),
      historyRow("2026-08-29", 3, 0), // 待审核期不入库计数
      historyRow("2026-08-30", 2, 2),
    ];
    expect(flowCounts(0, null, history).published).toEqual({ tone: "ink", label: "已入库 · 2 期 7 条" });
  });

  it("5. 边界：running 且 total=0（刚起跑）不显 0/0；暂存数与解析态解耦传入", () => {
    expect(flowCounts(0, parseState({ status: "running" }), []).parse).toEqual({ tone: "pulse", label: "解析 · 运行中" });
    expect(flowCounts(2, parseState({ status: "running" }), []).sync).toEqual({ tone: "ink", label: "已同步 · 暂存 2 条" });
  });
});

describe("shouldPollParse（spec13 契约 D：是否应轮询）", () => {
  it("仅 running 需要轮询；idle/done/failed 与 parse 字段缺失都不轮询", () => {
    expect(shouldPollParse(parseState({ status: "running" }))).toBe(true);
    expect(shouldPollParse(parseState({ status: "idle" }))).toBe(false);
    expect(shouldPollParse(parseState({ status: "done" }))).toBe(false);
    expect(shouldPollParse(parseState({ status: "failed" }))).toBe(false);
    expect(shouldPollParse(null)).toBe(false);
    expect(shouldPollParse(undefined)).toBe(false);
  });
});

describe("parsePollStopRefresh（spec13 契约 D/F：何时停 + 是否补拉数据）", () => {
  it("轮询中 → done 且 processed>0：停轮询并补拉一次（新建议落地）", () => {
    expect(parsePollStopRefresh("running", parseState({ status: "done", processed: 5, total: 5 }))).toBe(true);
  });

  it("轮询中 → done 但 processed=0（空跑）：不补拉", () => {
    expect(parsePollStopRefresh("running", parseState({ status: "done", processed: 0 }))).toBe(false);
  });

  it("轮询中 → failed：补拉一次（契约 D：转入终态重拉）", () => {
    expect(parsePollStopRefresh("running", parseState({ status: "failed", errors: ["boom"] }))).toBe(true);
  });

  it("非轮询中转换与首挂载即终态：不补拉（挂载 loadPending 已取最新）", () => {
    expect(parsePollStopRefresh("idle", parseState({ status: "done", processed: 3 }))).toBe(false);
    expect(parsePollStopRefresh(undefined, parseState({ status: "done", processed: 3 }))).toBe(false);
    expect(parsePollStopRefresh("running", parseState({ status: "running", processed: 1, total: 9 }))).toBe(false);
    expect(parsePollStopRefresh("running", null)).toBe(false);
  });
});

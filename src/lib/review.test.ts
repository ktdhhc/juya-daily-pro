// review.ts TDD 测试（spec12 票 02 + spec13 票 02 + spec14 票 02）：categorizePending 三态分组、
// 今日流水线卡三段行（flowCardRows）、待办 tab（todoTabs / defaultTodoTab）、
// 解析作业轮询决策（shouldPollParse / parsePollStopRefresh）纯函数。
// 覆盖：三态各一例 / missing_owner 归待解析（含 enrichState 未返回的兜底）/ 组序 unparsed→parsed→noNeed；
// spec14：三段行三态文案与 0 值省略、tab 合并序与默认落点；spec13：轮询启停与终态补拉。
import { describe, expect, it } from "vitest";
import { LastParseRecord } from "@/components/review/last-parse";
import { ParseJobStatus, ParseStatePayload, PendingItem, ReviewHistory, SyncRun } from "./api";
import {
  categorizePending,
  defaultTodoTab,
  flowCardRows,
  parsePollStopRefresh,
  shouldPollParse,
  todoTabs,
} from "./review";

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

  it("7. 多家命中且存在待处置候选 → blocked（spec16 决策 6）；有 proposal 的仍归 parsed", () => {
    const multiBlocked = item({
      id: "20260903-2",
      owners: [
        { companyId: "a", name: "A", color: "#111111", role: null },
        { companyId: "b", name: "B", color: "#222222", role: null },
      ],
      candidate: { id: "inception", name: "Inception Labs", aliases: [], confidence: "high", reason: "主角；融资" },
    });
    const multiParsed = item({
      id: "20260903-3",
      owners: [
        { companyId: "a", name: "A", color: "#111111", role: "primary" },
        { companyId: "b", name: "B", color: "#222222", role: "partner" },
      ],
      proposal: PROPOSAL,
      candidate: { id: "inception", name: "Inception Labs", aliases: [], confidence: "high", reason: "主角" },
    });
    const out = categorizePending([multiBlocked, multiParsed]);
    expect(out.blocked).toEqual([multiBlocked]);
    expect(out.parsed).toEqual([multiParsed]);
    expect(out.unparsed).toEqual([]);
    expect(out.noNeed).toEqual([]);
  });
});

// ═══════════ spec14 票 02：今日流水线卡三段行（先红后绿）═══════════

/** 造数：ParseStatePayload（spec13 契约 C 形状），缺省零值 */
function parseState(partial: Partial<ParseStatePayload> & { status: ParseJobStatus }): ParseStatePayload {
  return { startedAt: null, finishedAt: null, processed: 0, total: 0, remaining: 0, errors: [], ...partial };
}

/** 造数：ReviewHistory 行（③ 行只消费 published 与 date，其余字段给固定缺省） */
function historyRow(date: string, items: number, published: number): ReviewHistory {
  return { date, status: "ok", error: null, attemptedAt: "2026-08-30 10:00:00", items, published, attributed: 0 };
}

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

// ═══════════ 同步提示语诚实化（消息 = 新增/更新/核对 三分类，零信息缺失）═══════════

import { syncToastMessage } from "./api";

describe("syncToastMessage（同步成功条文案）", () => {
  const base = { ok: true, dates: [], stagedDates: [], stagedItems: 0, failures: [] as { date: string; error: string }[] };

  it("全未变化：「核对 4 期未变化」（不再出现无信息的「同步 4 期」）", () => {
    expect(
      syncToastMessage({ ...base, dates: ["2026-09-01"], added: [], updated: [], unchanged: ["2026-09-01", "2026-08-31", "2026-08-30", "2026-08-29"] })
    ).toBe("同步完成 · 核对 4 期未变化");
  });

  it("有新增：新增期数 + 待审核条数；失败期附尾", () => {
    expect(
      syncToastMessage({
        ...base,
        dates: ["2026-09-02"],
        added: ["2026-09-02"],
        updated: [],
        unchanged: ["2026-09-01", "2026-08-31", "2026-08-30"],
        stagedItems: 16,
        failures: [{ date: "2026-08-29", error: "HTTP 404" }],
      })
    ).toBe("同步完成 · 新增 1 期 · 核对 3 期未变化 · 16 条待审核 · 失败 1 期");
  });

  it("有更新：更新期数参与；stagedItems=0 省略待审核段", () => {
    expect(
      syncToastMessage({
        ...base,
        dates: ["2026-09-01"],
        added: [],
        updated: ["2026-09-01"],
        unchanged: ["2026-08-31", "2026-08-30"],
      })
    ).toBe("同步完成 · 更新 1 期 · 核对 2 期未变化");
  });
});

/** 造数：SyncRun 行（spec14 契约 B 形状，字段名对齐工单：startedAt/durationMs/windowDates/...） */
function syncRun(partial: Partial<SyncRun> & { startedAt: string }): SyncRun {
  return {
    durationMs: 12000,
    windowDates: ["2026-08-30", "2026-08-29", "2026-08-28", "2026-08-27"],
    added: [],
    updated: [],
    unchanged: [],
    failures: [],
    stagedItems: 0,
    ok: true,
    ...partial,
  };
}

describe("flowCardRows（spec14 今日流水线卡三段行文案）", () => {
  it("1. ① 行有记录：时间 · 窗口 N 期 · 新增/更新/未变化（0 值段省略）· 耗时 s", () => {
    const out = flowCardRows(
      syncRun({ startedAt: "2026-08-30T10:30:00.000Z", added: ["2026-08-30"], updated: ["2026-08-29"], unchanged: ["2026-08-28", "2026-08-27"] }),
      parseState({ status: "idle" }),
      null,
      []
    );
    expect(out.sync).toEqual({
      tone: "ink",
      text: "08-30 10:30 · 窗口 4 期 · 新增 1 · 更新 1 · 未变化 2 · 耗时 12.0s",
    });
  });

  it("2. ① 行 0 值段与 0 耗时省略：全未变化只显 窗口/未变化；耗时 <0.1s 不显", () => {
    const out = flowCardRows(syncRun({ startedAt: "2026-08-30 09:00:00", durationMs: 40, unchanged: ["2026-08-30"] }), null, null, []);
    expect(out.sync).toEqual({ tone: "ink", text: "08-30 09:00 · 窗口 4 期 · 未变化 1" });
  });

  it("3. ① 行失败记录：ok=false 朱橙（accent），时间 · 窗口 N 期 · 失败 X + 首条原因", () => {
    const out = flowCardRows(
      syncRun({
        startedAt: "2026-08-30 08:00:00",
        ok: false,
        failures: [{ date: "2026-08-30", error: "HTTP 404" }, { date: "2026-08-29", error: "boom" }],
      }),
      null,
      null,
      []
    );
    expect(out.sync).toEqual({ tone: "accent", text: "08-30 08:00 · 窗口 4 期 · 失败 2 · HTTP 404" });
  });

  it("4. ① 行同步中（syncing=true）：呼吸点标 pulse「同步中…」，优先于任何记录", () => {
    const out = flowCardRows(syncRun({ startedAt: "2026-08-30 08:00:00" }), null, null, [], true);
    expect(out.sync).toEqual({ tone: "pulse", text: "同步中…" });
  });

  it("5. ① 行无记录：无 syncRun 且非同步中 →「尚未同步」（ink）", () => {
    expect(flowCardRows(null, null, null, []).sync).toEqual({ tone: "ink", text: "尚未同步" });
  });

  it("6. ② 行 running：pulse「运行中 k/M」；total 未写入（0）不显 0/0", () => {
    let out = flowCardRows(null, parseState({ status: "running", processed: 4, total: 12 }), null, []);
    expect(out.parse).toEqual({ tone: "pulse", text: "运行中 4/12" });
    out = flowCardRows(null, parseState({ status: "running" }), null, []);
    expect(out.parse).toEqual({ tone: "pulse", text: "运行中" });
  });

  it("7. ② 行 done：「已完成 · 处理 n/m」+ 完成时间；failed：朱橙「失败」+ errors 首条", () => {
    let out = flowCardRows(null, parseState({ status: "done", processed: 8, total: 8, finishedAt: "2026-08-30 11:00:00" }), null, []);
    expect(out.parse).toEqual({ tone: "ink", text: "08-30 11:00 已完成 · 处理 8/8" });
    out = flowCardRows(null, parseState({ status: "failed", errors: ["20260901-3: LLM 超时"] }), null, []);
    expect(out.parse).toEqual({ tone: "accent", text: "失败 · 20260901-3 · LLM 超时" });
  });

  it("8. ② 行 idle：服务端无运行记录时终态缓存兜底（「上次解析 …」）；无缓存 →「空闲」", () => {
    const cached: LastParseRecord = { at: "08-29 18:00", status: "done", processed: 5, total: 5, remaining: 0, errors: [] };
    expect(flowCardRows(null, parseState({ status: "idle" }), cached, []).parse).toEqual({
      tone: "ink",
      text: "上次解析 08-29 18:00 · 处理 5/5",
    });
    expect(flowCardRows(null, parseState({ status: "idle" }), null, []).parse).toEqual({ tone: "ink", text: "空闲" });
  });

  it("9. ③ 行已入库汇总：published>0 过滤 →「至 <max date> · 共 X 期 Y 条」；空 →「暂无入库」", () => {
    const history = [historyRow("2026-08-28", 5, 5), historyRow("2026-08-30", 2, 2), historyRow("2026-08-29", 3, 0)];
    expect(flowCardRows(null, null, null, history).published).toEqual({ tone: "ink", text: "至 2026-08-30 · 共 2 期 7 条" });
    expect(flowCardRows(null, null, null, []).published).toEqual({ tone: "ink", text: "暂无入库" });
  });
});

// ═══════════ spec14 票 02：待办 tab（先红后绿）═══════════

describe("todoTabs（spec14 待办三 tab）", () => {
  it("1. 待审核 tab = parsed + noNeed 合并（parsed 在前，合并序保持原相对序）；blocked / 异常各自成 tab", () => {
    const parsedItem = item({
      id: "20260901-2",
      owners: [
        { companyId: "a", name: "A", color: "#111111", role: "primary" },
        { companyId: "b", name: "B", color: "#222222", role: "partner" },
      ],
      proposal: PROPOSAL,
    });
    const noNeedItem = item({ id: "20260901-3", owners: [{ companyId: "c", name: "C", color: "#333333", role: null }] });
    const blockedItem = item({
      id: "20260902-6",
      enrichState: "missing_owner",
      candidate: { id: "runway", name: "Runway", aliases: ["Runway"], confidence: "high", reason: "新闻主角" },
    });
    const out = todoTabs({ unparsed: [], blocked: [blockedItem], parsed: [parsedItem, noNeedItem], noNeed: [] }, []);
    expect(out.map((t) => t.key)).toEqual(["todo", "blocked", "issues"]);
    expect(out[0].label).toBe("待审核");
    expect(out[0].count).toBe(2);
    expect(out[0].items).toEqual([parsedItem, noNeedItem]);
    expect(out[1].label).toBe("缺候选待入册");
    expect(out[1].count).toBe(1);
    expect(out[1].items).toEqual([blockedItem]);
    expect(out[2].label).toBe("异常");
    expect(out[2].count).toBe(0);
    expect(out[2].items).toEqual([]);
  });

  it("2. 异常 tab 计数 = parse.errors 摘要行数；行文案「itemId · 原因」", () => {
    const out = todoTabs(
      { unparsed: [], blocked: [], parsed: [], noNeed: [] },
      ["20260901-3: LLM 超时", "20260901-7: JSON 解析失败"]
    );
    expect(out[2].count).toBe(2);
    expect(out[2].errors).toEqual([
      { itemId: "20260901-3", reason: "LLM 超时" },
      { itemId: "20260901-7", reason: "JSON 解析失败" },
    ]);
  });

  it("3. 默认 tab = 第一个 count>0 的 key；全空 → 待审核（todo）", () => {
    expect(defaultTodoTab([2, 0, 0])).toBe("todo");
    expect(defaultTodoTab([0, 3, 0])).toBe("blocked");
    expect(defaultTodoTab([0, 0, 1])).toBe("issues");
    expect(defaultTodoTab([0, 0, 0])).toBe("todo");
  });
});

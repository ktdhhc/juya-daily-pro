"use client";

import { useMemo } from "react";
import { CompanyIndexEntry, PatchOwnersBody, PendingItem } from "@/lib/api";
import { CategorizedPending, TodoTab, TodoTabKey, isMissingOwner, todoTabs } from "@/lib/review";
import { LogoSeal } from "../common/LogoSeal";
import { ProposalEditor } from "./ProposalEditor";

// 归属主次文案（与 ProposalEditor 同表；primary 强调、partner/subject 弱化，FRONTEND_DESIGN §4.9）
const ROLE_LABELS: Record<string, string> = {
  primary: "主导",
  partner: "合作",
  subject: "被报道",
};

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function dayLabel(date: string): string {
  const d = new Date(date + "T00:00:00");
  return `${date} 周${WEEKDAYS[d.getDay()]}`;
}

// id = YYYYMMDD-N → "YYYY-MM-DD"（pending 条目无 date 字段，从 id 反解，形状见 src/lib/api.ts）
function dateFromItemId(id: string): string {
  return `${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}`;
}

interface ItemProps {
  item: PendingItem;
  companies: CompanyIndexEntry[];
  onPatch: (itemId: string, owners: PatchOwnersBody[]) => Promise<unknown>;
}

/** 条目行：页边编号 + 待审/已决点标 + 标题摘要 + 现归属徽章（无 role 灰显）与
 *  proposal 建议徽章（主次）对比 + 编辑控件（ProposalEditor）。 */
function ReviewItem({ item, companies, onPatch }: ItemProps) {
  const decided = item.proposal?.llmModel === "human-edit";

  // 建议行公司名/色查找（现归属 ∪ 公司索引）
  const metaById = useMemo(() => {
    const m = new Map<string, { name: string; color: string }>();
    for (const o of item.owners) m.set(o.companyId, { name: o.name, color: o.color });
    for (const c of companies) if (!m.has(c.id)) m.set(c.id, { name: c.name, color: c.color });
    return m;
  }, [item.owners, companies]);

  return (
    <article className="rule-t py-4">
      {/* 页边编号 + 待审（朱橙点）/已决（墨点）状态（FRONTEND_DESIGN §4.9） */}
      <div className="flex items-baseline gap-2">
        <span className="item-no" style={{ fontSize: 14 }}>
          {item.tag}
        </span>
        <span
          aria-hidden
          className="text-xs"
          style={{ color: decided ? "var(--fg)" : "var(--accent)", fontSize: 9, lineHeight: 1 }}
        >
          ●
        </span>
        <span className="text-xs" style={{ color: "var(--fg-muted)" }}>
          {decided ? "已决" : "待审"}
          {item.proposal && !decided && ` · ${item.proposal.llmModel}`}
        </span>
      </div>

      <h3 className="item-title mt-1">{item.title}</h3>
      <div className="item-meta mt-0.5">{item.category}</div>
      {item.summary && <p className="item-summary mt-1">{item.summary}</p>}

      {/* missing_owner 行内候选关联提示（spec12 契约 E）：候选公司区「复制 YAML」入册后随重解析消失 */}
      {isMissingOwner(item) && item.candidate && (
        <div className="text-xs mt-1" style={{ color: "var(--accent)" }}>
          候选公司：{item.candidate.name}（待入册）
        </div>
      )}

      {/* 现状 vs 建议 对比行：现状 role=null → 灰显；建议 primary 强调、partner/subject 弱化 */}
      {(item.owners.length > 0 || item.proposal !== null) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5">
          {item.owners.length > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="text-xs shrink-0" style={{ color: "var(--fg-muted)" }}>
                现状
              </span>
              {item.owners.map((o) => (
                <span
                  key={o.companyId}
                  className="flex items-center"
                  style={o.role === null ? { filter: "grayscale(1)", opacity: 0.55 } : undefined}
                >
                  <LogoSeal
                    id={o.companyId}
                    name={o.name}
                    color={o.color}
                    size={18}
                    fontSize={10}
                    dataTip={o.name}
                    ariaHidden
                  />
                </span>
              ))}
            </span>
          )}
          {item.proposal && item.proposal.owners.length > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="text-xs shrink-0" style={{ color: "var(--fg-muted)" }}>
                建议
              </span>
              {item.proposal.owners.map((o) => {
                const meta = metaById.get(o.companyId);
                const strong = o.role === "primary";
                return (
                  <span key={o.companyId} className="flex items-center gap-1">
                    <LogoSeal
                      id={o.companyId}
                      name={meta?.name ?? o.companyId}
                      color={meta?.color ?? "#888888"}
                      size={18}
                      fontSize={10}
                      ariaHidden
                    />
                    <span
                      className="text-xs px-1.5 py-0.5"
                      style={{
                        borderRadius: "var(--radius-control)",
                        background: strong ? "var(--accent)" : "var(--tag-bg)",
                        color: strong ? "var(--bg)" : "var(--fg-muted)",
                      }}
                    >
                      {ROLE_LABELS[o.role] ?? o.role}
                    </span>
                  </span>
                );
              })}
            </span>
          )}
        </div>
      )}

      <div className="mt-2">
        <ProposalEditor item={item} companies={companies} onPatch={onPatch} />
      </div>
    </article>
  );
}

interface Props {
  /** 三态分组（categorizePending 产出） */
  groups: CategorizedPending;
  /** parse.errors（spec13 契约 C）：异常 tab 摘要行来源 */
  parseErrors: string[];
  /** 激活 tab（父层持有：数据重拉后由 defaultTodoTab 重算默认落点） */
  activeKey: TodoTabKey;
  onTabChange: (key: TodoTabKey) => void;
  companies: CompanyIndexEntry[];
  onPatch: (itemId: string, owners: PatchOwnersBody[]) => Promise<unknown>;
}

/** 待办 tab 区（spec14 契约 D，替代四态分组首屏）：tab 头（计数徽章 + 激活墨线）+ 对应面板。
 *  待审核 tab = parsed + noNeed 合并条目（按日期小节，行沿用 ReviewItem）；
 *  缺候选 tab 沿用既有行（含候选提示）；异常 tab 只列「itemId · 原因」摘要行（无条目体）。
 *  根节点挂 id="review-todos"（今日卡主按钮滚动锚点，spec14 契约 C）。 */
export function StagedIssueList({ groups, parseErrors, activeKey, onTabChange, companies, onPatch }: Props) {
  const tabs: TodoTab[] = todoTabs(groups, parseErrors);
  const active = tabs.find((t) => t.key === activeKey) ?? tabs[0];

  return (
    <div className="fade-up" id="review-todos">
      {/* tab 头：计数徽章 + 激活 3px 墨线（同 nav-link 语言）；先红后绿 = 序固定 todo → blocked → issues */}
      <div className="rule-t flex items-center gap-6" role="tablist" aria-label="待办分类">
        {tabs.map((t) => {
          const on = t.key === active.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onTabChange(t.key)}
              className="relative pt-2 pb-2 text-sm shrink-0"
              style={{
                color: on ? "var(--fg)" : "var(--fg-muted)",
                fontWeight: on ? 600 : 400,
                background: "none",
                border: "none",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <span className="flex items-center gap-1.5">
                {t.label}
                {/* 计数徽章：>0 且 todo/blocked 用朱橙（收件箱「需处理」语义），0 灰显 */}
                <span
                  className="text-xs px-1.5"
                  style={{
                    borderRadius: "var(--radius-control)",
                    fontVariantNumeric: "tabular-nums",
                    color: t.count > 0 && t.key !== "issues" ? "var(--accent)" : "var(--fg-muted)",
                  }}
                >
                  {t.count}
                </span>
              </span>
              {on && (
                <span
                  aria-hidden
                  className="absolute left-0 right-0 bottom-0"
                  style={{ height: 3, background: "var(--fg)" }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* 面板：待审核 / 缺候选 = 条目体（按日期小节）；异常 = 摘要行 */}
      {active.key === "issues" ? (
        <div role="tabpanel" aria-label={`异常（${active.count} 条）`}>
          {active.errors.length === 0 ? (
            <p className="rule-t py-4 text-xs" style={{ color: "var(--fg-muted)" }}>
              无异常。
            </p>
          ) : (
            active.errors.map((e, i) => (
              <div key={`${e.itemId}-${i}`} className="rule-t py-2 text-xs flex items-baseline gap-3 min-w-0">
                <span className="item-no shrink-0" style={{ fontSize: 12 }}>
                  {e.itemId || "—"}
                </span>
                <span className="min-w-0 truncate" style={{ color: "var(--accent)" }} title={e.reason}>
                  {e.reason}
                </span>
              </div>
            ))
          )}
        </div>
      ) : (
        <div role="tabpanel" aria-label={`${active.label}（${active.count} 条）`}>
          {active.items.length === 0 ? (
            <p className="rule-t py-4 text-xs" style={{ color: "var(--fg-muted)" }}>
              {active.key === "todo" ? "暂无待审条目。" : "无缺候选条目。"}
            </p>
          ) : (
            // 按日期小节（条目无 date 字段，从 id 反解）；同日期保持原序
            [...itemsByDate(active.items)].map(([date, list]) => (
              <div key={date}>
                <div className="text-xs mt-3" style={{ color: "var(--fg-light)" }}>
                  {dayLabel(date)}
                </div>
                {list.map((it) => (
                  <ReviewItem key={it.id} item={it} companies={companies} onPatch={onPatch} />
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** 条目按日期小节归并（保持输入序） */
function itemsByDate(items: PendingItem[]): [string, PendingItem[]][] {
  const byDate = new Map<string, PendingItem[]>();
  for (const it of items) {
    const d = dateFromItemId(it.id);
    const list = byDate.get(d) ?? [];
    list.push(it);
    byDate.set(d, list);
  }
  return [...byDate];
}

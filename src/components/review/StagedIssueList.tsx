"use client";

import { useMemo } from "react";
import { CompanyIndexEntry, PatchOwnersBody, PendingItem } from "@/lib/api";
import { CategorizedPending, isMissingOwner } from "@/lib/review";
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
  /** 三态分组（categorizePending 产出，组序即渲染序） */
  groups: CategorizedPending;
  companies: CompanyIndexEntry[];
  onPatch: (itemId: string, owners: PatchOwnersBody[]) => Promise<unknown>;
}

// 四态分组节（spec12 契约 B + 走查补正）：空组不渲染；待解析/缺候选待入册标题朱橙（收件箱「需处理」语义）
const SECTIONS: { key: keyof CategorizedPending; label: string }[] = [
  { key: "unparsed", label: "待解析" },
  { key: "blocked", label: "缺候选待入册" },
  { key: "parsed", label: "已解析待确认" },
  { key: "noNeed", label: "无需解析" },
];

/** 三态分组条目区（spec12 票 02）：每组标题带计数，组内按日期小节排列，条目行沿用 ReviewItem。
 *  根节点挂 id="review-staged"（数据流标头①段滚动锚点，spec13 契约 E）。 */
export function StagedIssueList({ groups, companies, onPatch }: Props) {
  return (
    <div className="fade-up" id="review-staged">
      {SECTIONS.map(({ key, label }, idx) => {
        const items = groups[key];
        if (items.length === 0) return null;
        // 组内按日期小节（条目无 date 字段，从 id 反解）；同日期保持原序
        const byDate = new Map<string, PendingItem[]>();
        for (const it of items) {
          const d = dateFromItemId(it.id);
          const list = byDate.get(d) ?? [];
          list.push(it);
          byDate.set(d, list);
        }
        return (
          <section key={key} aria-label={`${label}（${items.length} 条）`} className={idx > 0 ? "mt-8" : undefined}>
            <div className="day-head">
              <span
                className="text-sm font-semibold"
                style={{
                  color:
                    key === "unparsed" || key === "blocked" ? "var(--accent)" : "var(--fg)",
                }}
              >
                {label}
              </span>
              <span className="h-px flex-1" style={{ background: "var(--rule)" }} aria-hidden />
              <span className="facet-count">{items.length} 条</span>
            </div>
            {[...byDate].map(([date, list]) => (
              <div key={date}>
                <div className="text-xs mt-3" style={{ color: "var(--fg-light)" }}>
                  {dayLabel(date)}
                </div>
                {list.map((it) => (
                  <ReviewItem key={it.id} item={it} companies={companies} onPatch={onPatch} />
                ))}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

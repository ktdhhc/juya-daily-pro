"use client";

import { useMemo } from "react";
import { CompanyIndexEntry, PatchOwnersBody, PendingDateGroup, PendingItem } from "@/lib/api";
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
  dates: PendingDateGroup[];
  companies: CompanyIndexEntry[];
  onPatch: (itemId: string, owners: PatchOwnersBody[]) => Promise<unknown>;
}

/** 待审期卡片列表（spec10 票 03）：按期分节（day-head + 细线），条目行含归属对比与编辑控件 */
export function StagedIssueList({ dates, companies, onPatch }: Props) {
  return (
    <div className="fade-up">
      {dates.map((g) => (
        <section key={g.date} aria-label={`待审期 ${g.date}`}>
          <div className="day-head">
            <span
              className="text-sm font-semibold"
              style={{ color: "var(--fg)", fontVariantNumeric: "tabular-nums" }}
            >
              {dayLabel(g.date)}
            </span>
            <span className="h-px flex-1" style={{ background: "var(--rule)" }} aria-hidden />
            <span className="facet-count">{g.items.length} 条</span>
          </div>
          {g.items.map((it) => (
            <ReviewItem key={it.id} item={it} companies={companies} onPatch={onPatch} />
          ))}
        </section>
      ))}
    </div>
  );
}

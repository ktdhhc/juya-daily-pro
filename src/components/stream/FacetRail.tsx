"use client";

import { CompanyIndexEntry } from "@/lib/api";
import { CATEGORIES } from "@/lib/stream-categories";

/** /stream facet 状态（company/category/from/to；before_date 分页位不在此列，不进 URL——ADR-0012） */
export interface Facets {
  company: string;
  category: string;
  from: string;
  to: string;
}

export const EMPTY_FACETS: Facets = { company: "", category: "", from: "", to: "" };

interface Props {
  facets: Facets;
  companies: CompanyIndexEntry[];
  companiesError: boolean;
  onCompaniesRetry: () => void;
  onChange: (patch: Partial<Facets>) => void;
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="facet-group">
      <span className="v-label facet-group-label" aria-hidden>
        {label}
      </span>
      <div className="facet-group-body">{children}</div>
    </section>
  );
}

/** 索引 Facet 栏（FRONTEND_DESIGN §4.3）：竖排分组标题 + 细线、墨点选项行、tabular 计数右对齐 */
export function FacetRail({ facets, companies, companiesError, onCompaniesRetry, onChange }: Props) {
  return (
    <aside aria-label="筛选">
      <Group label="公司">
        {companiesError ? (
          <p className="text-xs px-2 py-1" style={{ color: "var(--fg-muted)" }}>
            公司索引加载失败，<button type="button" className="text-link text-xs" onClick={onCompaniesRetry}>重试</button>
          </p>
        ) : companies.length === 0 ? (
          <div className="px-2 py-1 flex flex-col gap-1.5" aria-hidden>
            {[...Array(6)].map((_, i) => (
              <div key={i} className="galley h-4" style={{ width: `${88 - (i % 3) * 13}%` }} />
            ))}
          </div>
        ) : (
          <div className="facet-scroll">
            {companies.map((c) => {
              const active = facets.company === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`facet-row${active ? " active" : ""}`}
                  onClick={() => onChange({ company: active ? "" : c.id })}
                  aria-pressed={active}
                >
                  <span className="facet-dot" aria-hidden>{active ? "●" : "○"}</span>
                  <span className="truncate">{c.name}</span>
                  <span className="facet-count">{c.stats.total}</span>
                </button>
              );
            })}
          </div>
        )}
      </Group>

      <Group label="分类">
        {CATEGORIES.map((cat) => {
          const active = facets.category === cat;
          return (
            <button
              key={cat}
              type="button"
              className={`facet-row${active ? " active" : ""}`}
              onClick={() => onChange({ category: active ? "" : cat })}
              aria-pressed={active}
            >
              <span className="facet-dot" aria-hidden>{active ? "●" : "○"}</span>
              <span className="truncate">{cat}</span>
            </button>
          );
        })}
      </Group>

      <Group label="时间">
        <label className="flex items-center gap-2 px-1 py-1.5">
          <span className="text-xs shrink-0" style={{ color: "var(--fg-muted)" }}>自</span>
          <input
            type="date"
            className="facet-input"
            value={facets.from}
            max={facets.to || undefined}
            onChange={(e) => onChange({ from: e.target.value })}
            aria-label="起始日期"
          />
        </label>
        <label className="flex items-center gap-2 px-1 py-1.5">
          <span className="text-xs shrink-0" style={{ color: "var(--fg-muted)" }}>至</span>
          <input
            type="date"
            className="facet-input"
            value={facets.to}
            min={facets.from || undefined}
            onChange={(e) => onChange({ to: e.target.value })}
            aria-label="截止日期"
          />
        </label>
      </Group>
    </aside>
  );
}

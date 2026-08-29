"use client";

import { useMemo, useState } from "react";
import { ApiError, CompanyIndexEntry, PatchOwnersBody, PendingItem, ReviewRole } from "@/lib/api";
import { LogoSeal } from "../common/LogoSeal";

// 归属主次文案（CONTEXT.md Role：primary=主导方/发布方、partner=合作方、subject=被报道对象）
const ROLE_LABELS: Record<ReviewRole, string> = {
  primary: "主导",
  partner: "合作",
  subject: "被报道",
};

/** 提交基线：解析建议（含人工编辑终版）优先；无建议时按家数给缺省 role（单家=主导、多家=合作）。
 *  PATCH 为全量重写（服务端删后插），草稿即提交体。 */
function baselineOwners(item: PendingItem): PatchOwnersBody[] {
  if (item.proposal && item.proposal.owners.length > 0) {
    return item.proposal.owners.map((o) => ({ ...o }));
  }
  return item.owners.map((o) => ({
    companyId: o.companyId,
    role: item.owners.length === 1 ? "primary" : "partner",
  }));
}

interface Props {
  item: PendingItem;
  /** /api/companies 索引（新增归属的选源与 name/color 补全） */
  companies: CompanyIndexEntry[];
  /** 变更即提交：PATCH /api/review/item 全量 owners；抛错由本组件回滚并行内提示 */
  onPatch: (itemId: string, owners: PatchOwnersBody[]) => Promise<unknown>;
}

/** 单条目归属编辑器（spec10 票 03）：每个归属行 = 公司 + role select + 移除；「新增归属」从
 *  /api/companies 索引搜选。变更即 PATCH（行内 loading，失败回滚 + 行内错误提示）。
 *  约束 primary ≤1：前端先拦（他行自动让位为合作），服务端兜底；owners 非空（最后一家不可移除）。 */
export function ProposalEditor({ item, companies, onPatch }: Props) {
  const [draft, setDraft] = useState<PatchOwnersBody[]>(() => baselineOwners(item));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // 父层数据刷新后（PATCH 成功回写 / 重拉 pending）对齐提交基线：
  // 渲染期 props→state 同步（React 官方模式，同 DailyPage 挂载期同步范式），不用 effect
  const [syncedItem, setSyncedItem] = useState(item);
  if (syncedItem !== item) {
    setSyncedItem(item);
    setDraft(baselineOwners(item));
  }

  // 公司名/色查找：现归属优先，其次公司索引（新增行）
  const metaById = useMemo(() => {
    const m = new Map<string, { name: string; color: string }>();
    for (const o of item.owners) m.set(o.companyId, { name: o.name, color: o.color });
    for (const c of companies) if (!m.has(c.id)) m.set(c.id, { name: c.name, color: c.color });
    return m;
  }, [item.owners, companies]);

  const submit = async (next: PatchOwnersBody[]) => {
    if (saving) return;
    const prev = draft;
    setDraft(next);
    setSaving(true);
    setError("");
    try {
      await onPatch(item.id, next);
    } catch (e) {
      setDraft(prev); // 失败回滚
      setError(e instanceof ApiError ? (e.code === "unauthorized" ? "需要管理口令" : e.message) : "网络异常，请稍后重试");
    } finally {
      setSaving(false);
    }
  };

  // primary ≤1 前端先拦：某行改为主导时，原有主导行自动让位为合作
  const changeRole = (index: number, role: ReviewRole) => {
    const next = draft.map((o, j) => {
      if (j === index) return { ...o, role };
      if (role === "primary" && o.role === "primary") return { ...o, role: "partner" as const };
      return o;
    });
    void submit(next);
  };

  const removeOwner = (index: number) => {
    if (draft.length <= 1) return; // 服务端 owners 须为非空数组
    void submit(draft.filter((_, j) => j !== index));
  };

  // 新增归属：公司索引搜索（name/id/alias 包含匹配，已在草稿中的不重复出现）
  const [addTerm, setAddTerm] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const matches = useMemo(() => {
    const q = addTerm.trim().toLowerCase();
    const inDraft = new Set(draft.map((o) => o.companyId));
    const pool = companies.filter((c) => !inDraft.has(c.id));
    const hit = q === "" ? pool : pool.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.id.includes(q) ||
        c.aliases.some((a) => a.toLowerCase().includes(q)),
    );
    return hit.slice(0, 8);
  }, [addTerm, companies, draft]);

  const addCompany = (companyId: string) => {
    if (draft.some((o) => o.companyId === companyId)) return;
    setAddOpen(false);
    setAddTerm("");
    void submit([...draft, { companyId, role: "partner" }]);
  };

  return (
    <div aria-busy={saving || undefined}>
      {/* 归属行：公司 + 主次 select + 移除（既有 select/文字链控件语言，禁通用组件） */}
      <div>
        {draft.map((o, i) => {
          const meta = metaById.get(o.companyId);
          const name = meta?.name ?? o.companyId;
          return (
            <div key={o.companyId} className="flex items-center gap-2 py-1.5">
              <LogoSeal id={o.companyId} name={name} color={meta?.color ?? "#888888"} size={18} fontSize={10} ariaHidden />
              <span className="text-sm min-w-0 truncate" style={{ color: "var(--fg)" }}>
                {name}
              </span>
              <select
                className="control-input ml-auto shrink-0"
                style={{ width: 148, padding: "3px 8px", fontSize: 12 }}
                value={o.role}
                disabled={saving}
                onChange={(e) => changeRole(i, e.target.value as ReviewRole)}
                aria-label={`归属主次 · ${name}`}
              >
                {(Object.keys(ROLE_LABELS) as ReviewRole[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]} {r}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="text-link text-xs shrink-0"
                disabled={saving || draft.length <= 1}
                onClick={() => removeOwner(i)}
                aria-label={`移除归属 ${name}`}
                title={draft.length <= 1 ? "至少保留一个归属" : "移除归属"}
                style={draft.length <= 1 ? { opacity: 0.4 } : undefined}
              >
                移除
              </button>
            </div>
          );
        })}
      </div>

      {/* 新增归属：控制输入 + 候选下拉（浮层投影 token） */}
      <div className="relative inline-block mt-1">
        <input
          type="text"
          className="control-input"
          style={{ width: 264, padding: "4px 10px", fontSize: 12 }}
          placeholder="新增归属：搜公司名 / 别名 / id"
          value={addTerm}
          onChange={(e) => {
            setAddTerm(e.target.value);
            setAddOpen(true);
          }}
          onFocus={() => setAddOpen(true)}
          onBlur={() => setAddOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setAddOpen(false);
            if (e.key === "Enter" && matches.length > 0) {
              e.preventDefault();
              addCompany(matches[0].id);
            }
          }}
          aria-label="新增归属，搜索在册公司"
        />
        {addOpen && (
          <div
            className="overlay-panel absolute left-0 top-full mt-1 z-30 w-72 max-h-64 overflow-y-auto p-1"
            style={{ background: "var(--bg-card)" }}
            role="listbox"
            aria-label="在册公司搜索结果"
          >
            {matches.length === 0 ? (
              <div className="px-2.5 py-2 text-xs" style={{ color: "var(--fg-muted)" }}>
                无匹配公司
              </div>
            ) : (
              matches.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="facet-row w-full"
                  onMouseDown={(e) => e.preventDefault()} // 先于 input onBlur 触发，保证选中
                  onClick={() => addCompany(c.id)}
                  role="option"
                  aria-selected={false}
                >
                  <LogoSeal id={c.id} name={c.name} color={c.color} size={16} fontSize={9} ariaHidden />
                  <span className="min-w-0 truncate">{c.name}</span>
                  <span className="facet-count">{c.id}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* 行内错误提示（PATCH 失败已回滚，可重改） */}
      {error && (
        <p className="mt-1 text-xs" style={{ color: "var(--accent)" }} role="alert">
          保存失败：{error}（已还原）
        </p>
      )}
    </div>
  );
}

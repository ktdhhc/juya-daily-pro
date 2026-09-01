"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import {
  ApiError,
  ItemsPage,
  ReviewHistory,
  StreamItem,
  apiFetch,
  fetchReviewHistory,
  itemsQueryString,
} from "@/lib/api";
import { LogoSeal } from "../common/LogoSeal";

// 归属主次文案（与 ProposalEditor 同表；§4.9 徽章语言：primary 强调、其余弱化、未定灰显）
const ROLE_LABELS: Record<string, string> = {
  primary: "主导",
  partner: "合作",
  subject: "被报道",
};

/** 入库状态（spec12 契约 F）：published>0 →「已入库」；=0 且 items>0 →「待审核」；items=0 →「无条目」 */
function publishLabel(row: ReviewHistory): string {
  if (row.published > 0) return "已入库";
  if (row.items > 0) return "待审核";
  return "无条目";
}

/** 展开条目状态：按期懒加载 /api/items（公开端点，单日闭区间），单开一个期 */
interface Detail {
  date: string;
  loading: boolean;
  error: string;
  items: StreamItem[];
}

/** 同步历史折叠区（spec12 契约 F，/review 底部）：默认折叠，展开懒加载 GET /api/review/history。
 *  每行 = 成败点标 / 日期 / 同步时间 / 条数 / 入库状态 / 失败原因；行内「展开条目」按需拉该期
 *  公开条目清单（标题 + 分类 + 归属钤印带主次），「查看日报」跳 /?date=。 */
export function HistoryPanel() {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"loading" | "ok" | "fail">("loading");
  const [rows, setRows] = useState<ReviewHistory[]>([]);
  const [errMsg, setErrMsg] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);

  const load = useCallback(() => {
    setPhase("loading");
    fetchReviewHistory(30)
      .then((r) => {
        setRows(r.history);
        setPhase("ok");
      })
      .catch((e: unknown) => {
        setPhase("fail");
        setErrMsg(
          e instanceof ApiError ? (e.code === "unauthorized" ? "需要管理口令" : e.message) : "网络异常，请稍后重试"
        );
      });
  }, []);

  const toggle = () => {
    if (!open) load(); // 懒加载：每次展开都取最新（同步/入库后重开即见新数据）
    setOpen(!open);
  };

  // 展开条目（单开）：再点收起；/api/items 仅出已发布条目——未入库期展开为空（见行内提示）
  const toggleDetail = (date: string) => {
    if (detail !== null && detail.date === date && !detail.loading) {
      setDetail(null);
      return;
    }
    setDetail({ date, loading: true, error: "", items: [] });
    // 契约差异：/api/items 无 date 参数，用 from/to 单日闭区间；limit 限期数（单日恒 1 期）
    apiFetch<ItemsPage>(`/api/items?${itemsQueryString({ from: date, to: date, limit: 1 })}`)
      .then((page) => setDetail({ date, loading: false, error: "", items: page.items }))
      .catch((e: unknown) =>
        setDetail({
          date,
          loading: false,
          error: e instanceof ApiError ? e.message : "网络异常，请稍后重试",
          items: [],
        })
      );
  };

  return (
    <section className="mt-10" aria-label="同步历史">
      <div className="day-head">
        <span className="text-sm font-semibold" style={{ color: "var(--fg)" }}>
          同步历史
        </span>
        <span className="h-px flex-1" style={{ background: "var(--rule)" }} aria-hidden />
        <button type="button" className="text-link text-xs shrink-0" onClick={toggle} aria-expanded={open}>
          {open ? "收起" : "展开"}
        </button>
      </div>

      {open && (
        <div className="fade-up">
          {phase === "loading" && (
            <p className="rule-t py-2 text-xs" style={{ color: "var(--fg-muted)" }}>
              载入中…
            </p>
          )}
          {phase === "fail" && (
            <p className="rule-t py-2 text-xs flex items-center gap-2" style={{ color: "var(--fg-muted)" }} role="alert">
              <span>{errMsg}</span>
              <button type="button" className="text-link" onClick={load}>
                重试
              </button>
            </p>
          )}
          {phase === "ok" && rows.length === 0 && (
            <p className="rule-t py-2 text-xs" style={{ color: "var(--fg-muted)" }}>
              暂无同步记录——报头同步按钮跑过一次后这里会留痕。
            </p>
          )}
          {phase === "ok" &&
            rows.map((row) => (
              <div key={row.date} className="rule-t py-2 text-xs min-w-0">
                <div className="flex items-baseline gap-3 min-w-0" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {/* 成败点标：ok 墨点 / 失败朱橙（§4.9 点语言） */}
                  <span
                    aria-hidden
                    className="shrink-0"
                    style={{ color: row.status === "ok" ? "var(--fg)" : "var(--accent)", fontSize: 9, lineHeight: 1 }}
                  >
                    ●
                  </span>
                  <span className="shrink-0" style={{ color: "var(--fg)" }}>
                    {row.date}
                  </span>
                  <span className="shrink-0" style={{ color: "var(--fg-muted)" }} title="同步时间（UTC）">
                    {row.attemptedAt.slice(5, 16)}
                  </span>
                  <span className="shrink-0" style={{ color: "var(--fg-muted)" }}>
                    {row.items} 条
                  </span>
                  <span className="shrink-0" style={{ color: row.items === 0 ? "var(--fg-muted)" : "var(--fg)" }}>
                    {publishLabel(row)}
                  </span>
                  {row.error && (
                    <span className="min-w-0 truncate" style={{ color: "var(--accent)" }} title={row.error}>
                      {row.error}
                    </span>
                  )}
                  <span className="ml-auto shrink-0 flex items-center gap-3">
                    {row.items > 0 && (
                      <button
                        type="button"
                        className="text-link"
                        onClick={() => toggleDetail(row.date)}
                        aria-expanded={detail?.date === row.date}
                      >
                        {detail?.date === row.date ? "收起条目" : "展开条目"}
                      </button>
                    )}
                    <Link href={`/?date=${row.date}`} className="text-link shrink-0">
                      查看日报
                    </Link>
                  </span>
                </div>

                {/* 该期条目行式清单：标题 + 分类 + 归属钤印带主次（§4.9 徽章语言） */}
                {detail?.date === row.date && (
                  <div className="pl-4 mt-1.5">
                    {detail.loading && <p style={{ color: "var(--fg-muted)" }}>载入中…</p>}
                    {detail.error && (
                      <p style={{ color: "var(--accent)" }} role="alert">
                        {detail.error}
                      </p>
                    )}
                    {!detail.loading && !detail.error && detail.items.length === 0 && (
                      <p style={{ color: "var(--fg-muted)" }}>该期暂无公开条目（未入库期不可见）。</p>
                    )}
                    {detail.items.map((s) => (
                      <div key={s.id} className="py-1 flex items-baseline gap-2 min-w-0">
                        <span className="item-no shrink-0" style={{ fontSize: 12 }}>
                          {s.tag}
                        </span>
                        <span className="min-w-0 truncate flex-1" style={{ color: "var(--fg)" }} title={s.title}>
                          {s.title}
                        </span>
                        <span className="shrink-0" style={{ color: "var(--fg-muted)" }}>
                          {s.category}
                        </span>
                        <span className="shrink-0 flex items-center gap-1.5">
                          {s.owners.map((o) => (
                            <span
                              key={o.company}
                              className="flex items-center gap-1"
                              style={o.role === null ? { filter: "grayscale(1)", opacity: 0.55 } : undefined}
                            >
                              <LogoSeal
                                id={o.company}
                                name={o.name}
                                color={o.color}
                                size={18}
                                fontSize={10}
                                dataTip={o.name}
                                ariaHidden
                              />
                              {o.role !== null && (
                                <span
                                  className="text-xs px-1.5 py-0.5"
                                  style={{
                                    borderRadius: "var(--radius-control)",
                                    background: o.role === "primary" ? "var(--accent)" : "var(--tag-bg)",
                                    color: o.role === "primary" ? "var(--bg)" : "var(--fg-muted)",
                                  }}
                                >
                                  {ROLE_LABELS[o.role] ?? o.role}
                                </span>
                              )}
                            </span>
                          ))}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
        </div>
      )}
    </section>
  );
}

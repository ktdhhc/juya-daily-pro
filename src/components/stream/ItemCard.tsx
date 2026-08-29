"use client";

import { KeyboardEvent, MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogoSeal } from "../common/LogoSeal";
import { StreamItem } from "@/lib/api";

export type ItemCardVariant = "stream" | "company";

interface Props {
  item: StreamItem;
  /** stream = /stream 全量视图；company = 公司页（按 PRD 差异渲染） */
  variant?: ItemCardVariant;
  /** variant="company" 时传当前档案公司 id：单家不渲染徽章，多家渲染对方（提及）徽章 */
  profileCompanyId?: string;
  /** 列表内序号，首屏 ≤12 项做 20ms/项 stagger 淡入 */
  index?: number;
}

/** 阅读页锚点：/?date=<date>#article-<N>（ArticleView 的 h2 id 规则） */
export function issueAnchorHref(item: StreamItem): string {
  const base = `/?date=${item.date}`;
  return item.sequenceInt > 0 ? `${base}#article-${item.sequenceInt}` : base;
}

/** 钤印主次语言（spec09：徽章分主次，ADR-0015 裁决回填）——主导加大实印 / 参与常规实印 / 提及描边小印；tooltip 带角色词 */
const ROLE_SEAL: Record<"primary" | "partner" | "subject", { size: number; outline: boolean; tip: string }> = {
  primary: { size: 20, outline: false, tip: "主导" },
  partner: { size: 18, outline: false, tip: "参与" },
  subject: { size: 16, outline: true, tip: "提及" },
};

/** 公司钤印：18px 方形（2px 圆角），有 logo 渲染真实徽标、否则首字回退，hover 浮层 tooltip；
 *  owner 带 role 时按主次语言渲染（spec09） */
function OwnerSeal({
  owner,
  outline,
  size = 18,
}: {
  owner: StreamItem["owners"][number];
  outline?: boolean;
  size?: number;
}) {
  const roleStyle = owner.role ? ROLE_SEAL[owner.role] : undefined;
  const sealSize = roleStyle?.size ?? size;
  const isOutline = roleStyle ? roleStyle.outline : outline;
  const tip = roleStyle ? `${owner.name} · ${roleStyle.tip}` : owner.name;
  return (
    <Link
      href={`/company/${owner.company}`}
      className="shrink-0" // 原钤印 .seal 自带 flex-shrink:0，chip 内移后由 Link 保持
      aria-label={`查看公司 ${owner.name}`}
      onClick={(e) => e.stopPropagation()}
      tabIndex={-1} // 卡片本身可进焦点，钤印点击直达即可，避免双焦点停靠
    >
      <LogoSeal
        id={owner.company}
        name={owner.name}
        color={owner.color}
        size={sealSize}
        fontSize={Math.round(sealSize * 0.55)}
        outline={isOutline}
        dataTip={tip}
      />
    </Link>
  );
}

/** 条目卡（FRONTEND_DESIGN §4.2）：页边编号列 + 细线分隔 + 衬线标题 + 脚注钤印行，无默认卡片盒 */
export function ItemCard({ item, variant = "stream", profileCompanyId, index }: Props) {
  const router = useRouter();
  const hasNumber = item.sequenceInt > 0 && !!item.primaryLink;

  const openIssue = () => {
    router.push(issueAnchorHref(item));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openIssue();
    }
  };
  const stop = (e: MouseEvent) => e.stopPropagation();

  // variant="company"：徽章 = 同条目中的「对方」公司（描边印=提及）；单家不渲染
  const otherOwners =
    variant === "company" && item.owners.length > 1
      ? item.owners.filter((o) => o.company !== profileCompanyId)
      : [];

  const showFoot = item.relatedLinks.length > 0 || item.owners.length > 0;

  return (
    <article
      className="item-card"
      role="link"
      tabIndex={0}
      onClick={openIssue}
      onKeyDown={onKeyDown}
      aria-label={`${item.title} — 跳转 ${item.date} 原期`}
      style={index != null && index < 12 ? { animation: `overlay-in var(--dur-slow) var(--ease-out) ${index * 20}ms both` } : undefined}
    >
      <div className="item-no" aria-hidden>
        {hasNumber ? `#${item.sequenceInt}` : "·"}
      </div>

      <div className="min-w-0 flex flex-col gap-1.5">
        <h3 className="item-title flex items-start gap-1.5">
          <span className="min-w-0">{item.title}</span>
          {item.primaryLink && (
            <a
              href={item.primaryLink}
              target="_blank"
              rel="noopener noreferrer"
              onClick={stop}
              className="shrink-0 mt-0.5 no-underline"
              style={{ color: "var(--fg-muted)" }}
              aria-label="打开原文链接"
              title="打开原文"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 17L17 7" />
                <path d="M8 7h9v9" />
              </svg>
            </a>
          )}
        </h3>

        <div className="item-meta">
          {item.category} · {item.date.slice(5)}
        </div>

        {item.summary && <p className="item-summary">{item.summary}</p>}

        {showFoot && (
          <div className="item-foot flex items-center gap-2 pt-0.5">
            {item.relatedLinks.length > 0 && <span>相关链接 {item.relatedLinks.length}</span>}
            {/* 多公司并列等尺寸一行（v1 无主次，ADR-0014） */}
            {variant === "stream" && item.owners.length > 0 && (
              <span className="flex items-center gap-1">
                {item.owners.map((o) => (
                  <OwnerSeal key={`${item.id}-${o.company}`} owner={o} />
                ))}
              </span>
            )}
            {otherOwners.length > 0 && (
              <span className="flex items-center gap-1">
                {otherOwners.map((o) => (
                  <OwnerSeal key={`${item.id}-${o.company}`} owner={o} outline />
                ))}
              </span>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

"use client";

import { CSSProperties, KeyboardEvent, MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

function sealStyle(color: string, size: number, fontSize: number): CSSProperties {
  return { "--seal": color, width: size, height: size, fontSize } as CSSProperties;
}

/** 公司钤印：18px 方形（2px 圆角），单字取公司名首字，hover 浮层 tooltip */
function OwnerSeal({
  owner,
  outline,
  size = 18,
}: {
  owner: StreamItem["owners"][number];
  outline?: boolean;
  size?: number;
}) {
  return (
    <Link
      href={`/company/${owner.company}`}
      className={`seal${outline ? " seal-outline" : ""}`}
      style={sealStyle(owner.color, size, Math.round(size * 0.55))}
      data-tip={owner.name}
      aria-label={`查看公司 ${owner.name}`}
      onClick={(e) => e.stopPropagation()}
      tabIndex={-1} // 卡片本身可进焦点，钤印点击直达即可，避免双焦点停靠
    >
      {owner.name.charAt(0)}
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

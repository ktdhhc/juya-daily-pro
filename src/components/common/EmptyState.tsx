"use client";

import Link from "next/link";
import { MouseEvent, ReactNode } from "react";

interface Props {
  /** 竖排短语（FRONTEND_DESIGN §4.6，如「未有所获」/「暂不可得」/「查无此家」） */
  phrase: string;
  /** 一行说明 */
  description: string;
  /** 重试为下划线文字链；onAction（按钮）或 href（Link）二选一 */
  actionLabel?: string;
  onAction?: () => void;
  href?: string;
  children?: ReactNode;
}

/** 空态与错误态：竖排短语 + 一行说明 + 文字链重试；无插画无 emoji（FRONTEND_DESIGN §4.6） */
export function EmptyState({ phrase, description, actionLabel, onAction, href, children }: Props) {
  const stop = (e: MouseEvent) => e.stopPropagation();
  return (
    <div className="fade-up py-20 flex items-start justify-center gap-7">
      <span
        className="v-label"
        style={{ fontSize: 14, color: "var(--fg)", letterSpacing: "0.5em", paddingTop: 4 }}
        aria-hidden
      >
        {phrase}
      </span>
      <div className="pt-0.5 max-w-sm min-w-0">
        <p className="text-sm leading-relaxed" style={{ color: "var(--fg-light)" }}>
          {description}
        </p>
        {actionLabel && href && (
          <p className="mt-3 text-sm">
            <Link href={href} className="text-link" onClick={stop}>
              {actionLabel}
            </Link>
          </p>
        )}
        {actionLabel && onAction && (
          <p className="mt-3 text-sm">
            <button type="button" className="text-link" onClick={onAction}>
              {actionLabel}
            </button>
          </p>
        )}
        {children}
      </div>
    </div>
  );
}

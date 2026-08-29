"use client";

import { useState } from "react";
import { setAdminToken } from "@/lib/auth";

interface Props {
  /** 探针 200 且口令已存储后的回调（Header 据此升级管理员态并收起输入条） */
  onVerified: () => void;
  /** Esc 收起回调（Header 持有展开开关，传入收起动作） */
  onClose?: () => void;
}

/** 管理口令输入条（spec07 Step 2.3）：复用搜索条交互——fade-up 容器、control-input、Esc 收起、Enter 提交。
 *  GET /api/admin/ping 探针验证；403 提示「口令不匹配」，不清空已输入，可重输。 */
export function AdminGate({ onVerified, onClose }: Props) {
  const [token, setToken] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const [checking, setChecking] = useState(false);

  const submit = async () => {
    const t = token.trim();
    if (!t || checking) return;
    setChecking(true);
    try {
      // 不走 apiFetch：探针必须用本次输入值直验，避免读到旧 token（票 2.3 明确）
      const res = await fetch("/api/admin/ping", { headers: { "x-admin-token": t } });
      if (res.ok) {
        setAdminToken(t);
        onVerified();
        return;
      }
      setMismatch(true); // 403（口令不符）：提示但不清空
    } catch {
      setMismatch(true); // 网络不可达等异常同样保留输入待重试
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="px-5 pb-2.5 fade-up flex items-center gap-3">
      <input
        autoFocus
        type="password"
        className="control-input flex-1"
        placeholder="输入管理口令"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose?.();
          else if (e.key === "Enter") void submit();
        }}
        aria-label="管理口令"
      />
      <button type="button" className="text-link shrink-0" onClick={() => void submit()} disabled={checking}>
        确认
      </button>
      {mismatch && (
        <span className="text-xs shrink-0" style={{ color: "var(--accent)" }} role="alert">
          口令不匹配
        </span>
      )}
    </div>
  );
}

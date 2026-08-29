"use client";

import { CSSProperties, useState } from "react";
import { LOGOS } from "@/lib/logos.generated";

interface Props {
  /** Company Registry id：命中 LOGOS（logos.generated）时渲染真实 logo，否则回退首字印 */
  id: string;
  /** 展示规范名，回退印取首字 */
  name: string;
  /** 公司色，回退印的 --seal 覆写 */
  color: string;
  /** 方形边长 px（沿用 .seal 尺寸体系：18 脚注 / 20 关联 / 30 索引 / 52 档案头） */
  size: number;
  /** 回退印首字字号 px */
  fontSize: number;
  /** 回退印描边态（提及，FRONTEND_DESIGN §4.2） */
  outline?: boolean;
  /** hover 浮层 tooltip（.seal[data-tip] 同款） */
  dataTip?: string;
  /** 装饰用途时对读屏隐藏（可点击场景由外层 Link aria-label 命名） */
  ariaHidden?: boolean;
}

/** 公司徽章（FRONTEND_DESIGN §4.7）：方形 chip（.seal 的 2px 圆角与尺寸体系不变，§4.2/§4.4 钤印的素材升级）。
 *  有 logo：纸底 + 1px 细边的 chip 内 object-contain，内边距使 logo 不顶边；img 失败（onerror）回退首字印。
 *  无 logo：直接首字方印（现状）。品牌「橘」方印不在此列，Header 内站点标保持原样。 */
export function LogoSeal({ id, name, color, size, fontSize, outline = false, dataTip, ariaHidden }: Props) {
  const [imgFailed, setImgFailed] = useState(false);
  const src = LOGOS[id];
  const box = { "--seal": color, width: size, height: size } as CSSProperties;

  if (!src || imgFailed) {
    return (
      <span
        className={`seal${outline ? " seal-outline" : ""}`}
        style={{ ...box, fontSize }}
        data-tip={dataTip}
        aria-hidden={ariaHidden || undefined}
      >
        {name.charAt(0)}
      </span>
    );
  }
  return (
    <span
      className="seal"
      style={{
        ...box,
        background: "var(--bg)",
        boxShadow: "inset 0 0 0 1px var(--rule)",
        padding: Math.max(2, Math.round(size * 0.12)),
      }}
      data-tip={dataTip}
      aria-hidden={ariaHidden || undefined}
    >
      <img
        src={src}
        alt=""
        onError={() => setImgFailed(true)}
        draggable={false}
        className="h-full w-full object-contain"
      />
    </span>
  );
}

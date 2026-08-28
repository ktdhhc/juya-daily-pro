import type { Metadata } from "next";
import { REGISTRY } from "@/lib/registry.generated";
import { CompanyProfile } from "@/components/company/CompanyProfile";

// 静态导出下动态路由必须枚举：REGISTRY 30 家即来源（spec04 前置事实）；未知 id 由客户端 404 态兜底
export function generateStaticParams() {
  return REGISTRY.map((c) => ({ id: c.id }));
}

export const metadata: Metadata = {
  title: "公司档案 — 橘鸦 AI 日报",
};

/** Server Component 壳（generateStaticParams 所在），内部渲染 "use client" 的 CompanyProfile */
export default async function CompanyProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CompanyProfile id={id} />;
}

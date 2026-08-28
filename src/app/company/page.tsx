import type { Metadata } from "next";
import { CompanyIndex } from "@/components/company/CompanyIndex";

export const metadata: Metadata = {
  title: "公司 — 橘鸦 AI 日报",
  description: "30 家 AI 公司的事件档案索引",
};

export default function CompanyPage() {
  return <CompanyIndex />;
}

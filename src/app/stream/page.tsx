import type { Metadata } from "next";
import { StreamView } from "@/components/stream/StreamView";

export const metadata: Metadata = {
  title: "事件流 — 橘鸦 AI 日报",
  description: "跨期 AI 事件流，按公司 / 分类 / 时间切面筛选",
};

export default function StreamPage() {
  return <StreamView />;
}

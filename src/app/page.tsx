"use client";

import { useEffect, useState } from "react";
import {
  fetchDailyList,
  fetchDailyContent,
  parseMarkdown,
  DailyEntry,
  ParsedDaily,
} from "@/lib/juya";
import { DailyPage } from "@/components/DailyPage";

export default function Home() {
  const [entries, setEntries] = useState<DailyEntry[]>([]);
  const [data, setData] = useState<ParsedDaily | null>(null);
  const [latestId, setLatestId] = useState(0);
  const [latestDate, setLatestDate] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const list = await fetchDailyList();
        setEntries(list);
        // 读地址栏 ?date= 决定初始显示哪期，没有就用最新
        const wantDate = new URLSearchParams(window.location.search).get("date");
        const target = (wantDate && list.find((e) => e.date === wantDate)) || list[0];
        setLatestId(target.id);
        setLatestDate(target.date);
        const content = await fetchDailyContent(target.filename);
        const parsed = parseMarkdown(content);
        setData(parsed);
      } catch {
        setError("加载失败，请刷新重试");
      }
    })();
  }, []);

  return (
    <DailyPage
      entries={entries}
      initialData={data}
      initialIssueId={latestId}
      initialDate={latestDate}
      error={error}
    />
  );
}

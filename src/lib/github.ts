// 数据源：橘鸦官方站 daily.juya.uk
// （原 GitHub 源 jujuyaya/juya-ai-daily 因作者账号被封已失效）
export const SITE = "https://daily.juya.uk";
export const MD_BASE = `${SITE}/markdown`;

export interface DailyEntry {
  id: number; // 由日期推导（YYYYMMDD），仅用于排序/定位，新源已无「期号」
  date: string;
  filename: string;
}

export async function fetchDailyList(): Promise<DailyEntry[]> {
  // 归档页列出全部可读日期
  const res = await fetch(`${SITE}/archive/`);
  if (!res.ok) throw new Error("Failed to fetch daily list");
  const html = await res.text();
  const dates = [
    ...new Set([...html.matchAll(/(\d{4}-\d{2}-\d{2})/g)].map((m) => m[1])),
  ];

  const entries: DailyEntry[] = dates
    .map((date) => ({
      id: parseInt(date.replace(/-/g, ""), 10),
      date,
      filename: `${date}.md`,
    }))
    .sort((a, b) => b.id - a.id);

  return entries;
}

export async function fetchDailyContent(filename: string): Promise<string> {
  const res = await fetch(`${MD_BASE}/${filename}`);
  if (!res.ok) throw new Error("Failed to fetch content");
  return res.text();
}

/** Parse overview section into categories */
export interface OverviewItem {
  text: string;
  link?: string;
  tag?: string;
}

export interface OverviewCategory {
  name: string;
  items: OverviewItem[];
}

export interface ParsedDaily {
  date: string;
  coverImage?: string;
  title: string;
  videoLinks: { name: string; url: string }[];
  overview: OverviewCategory[];
  contentAfterOverview: string;
}

export function parseMarkdown(md: string): ParsedDaily {
  const lines = md.split("\n");
  let date = "";
  let coverImage: string | undefined;
  let title = "";
  const videoLinks: { name: string; url: string }[] = [];
  const overview: OverviewCategory[] = [];
  let contentStart = 0;

  // Find cover image（新格式首行即封面图）
  for (let i = 0; i < Math.min(lines.length, 8); i++) {
    const imgMatch = lines[i].match(/^!\[\]\((.+)\)$/);
    if (imgMatch) {
      coverImage = imgMatch[1];
      break;
    }
  }

  // 标题行形如「# AI 早报 2026-06-21」：日期在标题里；泛标题不另外展示
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const titleMatch = lines[i].match(/^#\s+(.+)/);
    if (!titleMatch) continue;
    const dm = titleMatch[1].match(/(\d{4}-\d{2}-\d{2})/);
    if (dm) date = dm[1];
    if (!/AI\s*早报/.test(titleMatch[1])) title = titleMatch[1];
    break;
  }

  // Find video links
  for (let i = 0; i < Math.min(lines.length, 12); i++) {
    const videoMatch = lines[i].match(/\*\*视频版\*\*[：:]\s*(.*)/);
    if (videoMatch) {
      const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
      let m;
      while ((m = linkRegex.exec(videoMatch[1])) !== null) {
        videoLinks.push({ name: m[1], url: m[2] });
      }
      break;
    }
  }

  // Parse overview section
  let inOverview = false;
  let currentCategory: OverviewCategory | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("## 概览")) {
      inOverview = true;
      continue;
    }
    if (inOverview && line.startsWith("---")) {
      contentStart = i;
      inOverview = false;
      break;
    }
    if (inOverview && line.startsWith("### ")) {
      if (currentCategory) overview.push(currentCategory);
      currentCategory = { name: line.replace("### ", ""), items: [] };
      continue;
    }
    if (inOverview && currentCategory && line.startsWith("- ")) {
      const itemText = line.replace(/^- /, "");
      const linkMatch = itemText.match(/\[↗\]\(([^)]+)\)/);
      const tagMatch = itemText.match(/`(#\d+)`/);
      currentCategory.items.push({
        text: itemText
          .replace(/\s*\[↗\]\([^)]+\)/, "")
          .replace(/\s*`#\d+`/, ""),
        link: linkMatch?.[1],
        tag: tagMatch?.[1],
      });
    }
  }
  if (currentCategory) overview.push(currentCategory);

  // Get the content after overview (the detailed articles)
  const contentAfterOverview = lines.slice(contentStart).join("\n");

  return { date, coverImage, title, videoLinks, overview, contentAfterOverview };
}

// parseIssue — 一期 Daily Issue markdown → 结构化 Item[] 的纯函数解析器。
// 契约与规则真相源: docs/spec/spec01-issue-parser.md 2.1 / 2.2
// 纯函数：无 fetch / fs / process / Cloudflare 专属 API（ADR-0011 只测纯函数）。
import type { Item } from "../../src/lib/schema";

export interface ParsedIssue {
  date: string; // "YYYY-MM-DD"，取自 "# … YYYY-MM-DD" 标题行；缺失抛 Error("issue date not found")
  items: Item[];
}

// ---------- 行形态正则 ----------

const RE_DATE = /(\d{4}-\d{2}-\d{2})/; // YYYY-MM-DD
const RE_H1 = /^#\s+(.*)$/; // h1 标题行（日期来源）
const RE_H2 = /^##\s+(.+?)\s*$/; // ## 概览 / ## <分类名>
const RE_H3_WITH_LINK = /^###\s+\[(.+?)\]\((.+?)\)\s*(?:`(#\d+)`)?\s*$/; // ### [标题](url) `#N`
const RE_H3_PLAIN = /^###\s+(.+?)(?:\s+`(#\d+)`)?\s*$/; // ### 标题 `#N`（标题不包 []）
const RE_H3_PREFIX = /^###\s+/; // 条目头边界（下一条目开始）
const RE_HR = /^-{3,}\s*$/; // --- 分隔线
const RE_QUOTE = /^>\s?(.*)$/; // > 摘要行
const RE_RELATED = /^相关链接[：:]/; // 相关链接块（全角或半角冒号）
const RE_LIST_LINK = /^-\s+\[(.*)\]\((.*)\)\s*$/; // - [x](url)
const RE_LIST_PLAIN = /^-\s+(.+?)\s*$/; // - url

interface RawItemCore {
  title: string;
  primaryLink?: string; // 无主链接时缺省
  tag: string; // `#N` 原文，缺失 ""
  seqInt: number; // #N 整数值（去前导零），缺失 0
  hasTag: boolean;
  category: string; // 所在 ## 节名；节外（防御性）""
}

interface RawItem extends RawItemCore {
  summary: string;
  hasSummary: boolean;
  bodyMd: string;
  relatedLinks: string[];
}

export function parseIssue(md: string): ParsedIssue {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");

  // ---- date：第一条含 YYYY-MM-DD 的 h1 行；无日期抛错 ----
  let date = "";
  for (const line of lines) {
    const h1 = RE_H1.exec(line);
    if (!h1) continue;
    const d = RE_DATE.exec(h1[1]);
    if (d) {
      date = d[1];
      break;
    }
  }
  if (date === "") throw new Error("issue date not found");
  const dateKey = date.replace(/-/g, "");

  // ---- 单遍扫描：区域划分（概览区跳过 / 正文节 / 节外）+ 条目收集 ----
  const raws: RawItem[] = [];
  // null = 当前不在任何 ## 节内（文首元信息、概览区结束后、文末提示尾行）
  let category: string | null = null;
  let inOverview = false; // ## 概览 区：到其后的 --- 或下一个 ## 为止，整段跳过

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const h2 = RE_H2.exec(line);
    if (h2) {
      const name = h2[1].trim();
      if (name === "概览") {
        inOverview = true; // 概览本身不是分类
      } else {
        inOverview = false;
        category = name;
      }
      continue;
    }
    if (inOverview) {
      if (RE_HR.test(line)) inOverview = false;
      continue;
    }

    // 条目头：带主链接 / 无主链接两种形态，#N 可缺失
    const withLink = RE_H3_WITH_LINK.exec(line);
    let title: string;
    let primaryLink: string | undefined;
    let tag = "";
    if (withLink) {
      title = withLink[1];
      primaryLink = withLink[2];
      tag = withLink[3] ?? "";
    } else {
      const plain = RE_H3_PLAIN.exec(line);
      if (!plain) continue; // 非条目头
      title = plain[1];
      tag = plain[2] ?? "";
    }

    const { raw, end } = scanItem(lines, i, {
      title,
      primaryLink,
      tag,
      hasTag: tag !== "",
      seqInt: tag !== "" ? parseInt(tag.slice(1), 10) : 0,
      category: category ?? "", // 节外条目（防御性，正常不发生）
    });
    raws.push(raw);
    i = end - 1; // 跳过本条目已消费的行；end 为下一边界行（### / ##）或 lines.length
  }

  // ---- id 分配 + Item 组装（spec 2.2 id / enrichState 规则）----
  const items: Item[] = [];
  const usedTaggedIds = new Set<string>();
  let fallbackSeq = 0; // -x<k> 的 k：无编号条目与重复 #N 条目按文档序共用一个 fallback 计数
  for (const raw of raws) {
    let id: string;
    const taggedId = raw.hasTag ? `${dateKey}-${raw.seqInt}` : "";
    if (taggedId !== "" && !usedTaggedIds.has(taggedId)) {
      id = taggedId;
      usedTaggedIds.add(taggedId);
    } else {
      fallbackSeq += 1;
      id = `${dateKey}-x${fallbackSeq}`;
    }

    // 半成功：缺 summary / 缺 #N / 缺相关链接 / category 为空 → pending
    const pending =
      !raw.hasSummary || !raw.hasTag || raw.relatedLinks.length === 0 || raw.category === "";

    const item: Item = {
      id,
      date,
      tag: raw.tag,
      sequenceInt: raw.seqInt,
      category: raw.category,
      title: raw.title,
      summary: raw.summary,
      bodyMd: raw.bodyMd,
      relatedLinks: raw.relatedLinks,
      owners: [], // 归属是 spec 03（匹配阶段）的事；missing_owner 亦由该阶段写入
      enrichState: pending ? "pending" : "ok",
    };
    if (raw.primaryLink !== undefined) item.primaryLink = raw.primaryLink;
    items.push(item);
  }

  return { date, items };
}

// ---------- 条目体扫描 ----------

// 从条目头下一行扫到条目结束（下一个 ### / ## 或文件尾），
// 提取 summary（头后第一条 > 行）、relatedLinks（相关链接块），并切出 bodyMd。
// 返回 end：边界行下标或 lines.length。
function scanItem(
  lines: string[],
  headerIdx: number,
  core: RawItemCore,
): { raw: RawItem; end: number } {
  let summary = "";
  let hasSummary = false;
  let bodyStart = headerIdx + 1; // 无 summary 行时，body 从条目头后开始
  let relatedIdx = -1;
  const relatedLinks: string[] = [];

  let j = headerIdx + 1;
  while (j < lines.length) {
    const line = lines[j];
    if (RE_H2.test(line) || RE_H3_PREFIX.test(line)) break; // 下一节 / 下一条目
    if (!hasSummary && RE_QUOTE.test(line)) {
      summary = line.replace(/^>\s?/, ""); // "> " 后原文
      hasSummary = true;
      bodyStart = j + 1;
      j++;
      continue;
    }
    if (RE_RELATED.test(line)) {
      relatedIdx = j;
      j = scanRelatedLinks(lines, j + 1, relatedLinks);
      continue;
    }
    j++;
  }
  const end = j;
  const bodyEnd = relatedIdx >= 0 ? relatedIdx : end; // bodyMd 到相关链接行之前
  const bodyMd = cleanBody(lines.slice(bodyStart, bodyEnd));
  return { raw: { ...core, summary, hasSummary, bodyMd, relatedLinks }, end };
}

// 相关链接块：marker 之后的 - [x](url) / - url 列表；空行后仍接 - 行则块未结束，
// 到 空行+---、空行+##、非列表行或文件尾为止。存 url。
function scanRelatedLinks(lines: string[], start: number, out: string[]): number {
  let k = start;
  while (k < lines.length) {
    const line = lines[k];
    const linked = RE_LIST_LINK.exec(line);
    if (linked) {
      out.push(linked[2].trim());
      k++;
      continue;
    }
    const plain = RE_LIST_PLAIN.exec(line);
    if (plain) {
      out.push(plain[1]);
      k++;
      continue;
    }
    if (line.trim() === "" && RE_LIST_PLAIN.test(lines[k + 1] ?? "")) {
      k++; // 块内空行（下一行仍是 - 列表项）
      continue;
    }
    break;
  }
  return k;
}

// bodyMd：trim 掉首尾空行与 --- 分隔线；中间内容（含图片行）原样保留；无正文 → ""
function cleanBody(lines: string[]): string {
  const isFiller = (s: string): boolean => s.trim() === "" || RE_HR.test(s);
  let a = 0;
  let b = lines.length;
  while (a < b && isFiller(lines[a])) a++;
  while (b > a && isFiller(lines[b - 1])) b--;
  return lines.slice(a, b).join("\n");
}

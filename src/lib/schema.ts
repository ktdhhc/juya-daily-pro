// Item 数据契约
// 见 docs/adr/0002-item-schema-and-primary-key.md

export interface Owner {
  company: string; // Company Registry id (slug)
  role?: "primary" | "partner" | "subject"; // 单家归属缺省；多家必填
}

export interface Item {
  id: string; // YYYYMMDD-N
  date: string; // YYYY-MM-DD
  tag: string; // #N
  sequenceInt: number; // #N 整数（#3 -> 3），用于稳定 cursor 排序；解析缺失则 0
  category: string; // 来自概览：要闻 / 模型发布 / ...
  title: string;
  primaryLink?: string; // 无主链接时缺省
  summary: string; // 概览 '>' 后那句原文，不二次补全
  bodyMd: string; // 正文段落 markdown 原文
  relatedLinks: string[];
  owners: Owner[]; // 0..N；enrich 阶段从白名单填入
  enrichState: "ok" | "missing_owner" | "pending";
}

// Company Registry 一条记录
export interface Company {
  id: string; // slug
  name: string; // 展示规范名
  aliases: string[]; // 字面量与正则混合（正则以 / 包裹）
  color: string; // 主色 hex
  status: "active" | "dormant" | "retired";
  notes: string; // 一句话定位，公司页 header 用
}

// LLM 提议入册的候选（未入册，位于 data/companies-pending.yaml）
export interface CompanyCandidate extends Company {
  confidence: number;
  reason: string;
  source: string; // 触发提议的 item id
}
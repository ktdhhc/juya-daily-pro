// 日报概览七分类（真相源 CONTEXT.md：Category 词条）。
// /stream facet 与公司页分类分布共用同一常量，保证口径一致。
export const CATEGORIES = [
  "要闻",
  "模型发布",
  "开发生态",
  "产品应用",
  "行业动态",
  "前瞻与传闻",
  "技术与洞察",
] as const;

export type Category = (typeof CATEGORIES)[number];

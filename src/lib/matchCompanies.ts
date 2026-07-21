import type { Company, Item, Owner } from "./schema";

const ALIAS_FIELD = /\/.*\//;

function aliasIsRegex(alias: string): boolean {
  return /^\/.*\/i?$/.test(alias);
}

function compileAliases(companies: Company[]): { alias: RegExp; companyId: string }[] {
  const out: { alias: RegExp; companyId: string }[] = [];
  for (const c of companies) {
    if (c.status === "retired") continue;
    for (const a of c.aliases) {
      if (aliasIsRegex(a)) {
        const body = a.replace(/^\//, "").replace(/\/i?$/, "");
        out.push({ alias: new RegExp(body, "i"), companyId: c.id });
      } else {
        out.push({ alias: new RegExp(escapeRegExp(a), "i"), companyId: c.id });
      }
    }
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface MatchResult {
  companyId: string;
  matchedAliases: string[];
}

export function matchCandidates(
  item: Pick<Item, "title" | "bodyMd">,
  registry: Company[],
): MatchResult[] {
  const compiled = compileAliases(registry);
  const haystack = `${item.title}\n${item.bodyMd}`;
  const byCompany = new Map<string, string[]>();

  for (const { alias, companyId } of compiled) {
    const m = alias.exec(haystack);
    if (m) {
      const hits = byCompany.get(companyId) ?? [];
      hits.push(m[0]);
      byCompany.set(companyId, hits);
    }
  }

  return [...byCompany.entries()].map(([companyId, matchedAliases]) => ({
    companyId,
    matchedAliases,
  }));
}

export function ownersByMatching(
  item: Pick<Item, "title" | "bodyMd">,
  registry: Company[],
): Owner[] {
  const matches = matchCandidates(item, registry);
  if (matches.length === 0) return [];
  if (matches.length === 1) {
    return [{ company: matches[0].companyId }]; // 单家归属 role 缺省
  }
  // 多家时返回无 role 候选；role 由第二段 LLM 补全
  return matches.map((m) => ({ company: m.companyId }));
}

export const _internals = { aliasIsRegex, ALIAS_FIELD };
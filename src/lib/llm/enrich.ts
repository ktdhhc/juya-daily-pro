// enrich 纯函数三件套（spec09 Step 2.1，ADR-0009：LLM 只判 primary，启发式补 partner/subject）。
// 纯函数：无 fetch / fs / process（ADR-0011 只测纯函数，真实调用在 scripts/enrich.ts 薄胶水里）。
// 位置说明：放 src/lib/llm/ 而非 worker/，spec10 编辑工作流的 Worker 解析段将复用同一套判别逻辑。
// enrich_cache.result 存「最终裁决数组」[{companyId, role, reason}]（reason 仅 primary，spec09 前置事实）。

// ---------- 类型 ----------

export interface EnrichItem {
  title: string;
  summary: string;
  bodyMd: string;
}

export interface EnrichCandidate {
  id: string; // Company Registry id（slug）
  name: string; // 展示规范名
  notes: string; // 一句话定位
  evidence: string[]; // 命中别名清单（调用方对 title/body 按别名重扫得出，matchCandidates 同款）
  hitInTitle?: boolean; // 命中位置标注（调用方得出）；缺省时 deriveRoles 按 evidence 对 item 重扫
  hitInBody?: boolean;
}

export interface EnrichVerdict {
  companyId: string;
  role: "primary" | "partner" | "subject";
  reason?: string; // 仅 primary 携带裁决理由
}

// ---------- parseCachedResult（人工纠错重应用通道，spec09 Step 4） ----------

const ROLES = ["primary", "partner", "subject"] as const;

// enrich_cache.result JSON → 裁决数组（--apply 重应用的输入）。人工可编辑 result，
// 因此校验必须严格：数组、每项 companyId 非空字符串、role ∈ 枚举、companyId 不重复；
// 任何不合法抛错（调用方按 item 记失败，不写库）。
export function parseCachedResult(raw: string): EnrichVerdict[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("非合法 JSON");
  }
  if (!Array.isArray(parsed)) throw new Error("顶层不是数组");
  const seen = new Set<string>();
  const out: EnrichVerdict[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) throw new Error("存在非对象元素");
    const { companyId, role, reason } = entry as Record<string, unknown>;
    if (typeof companyId !== "string" || companyId === "") throw new Error("companyId 缺失或非法");
    if (seen.has(companyId)) throw new Error(`companyId 重复：${companyId}`);
    seen.add(companyId);
    if (typeof role !== "string" || !ROLES.includes(role as (typeof ROLES)[number])) {
      throw new Error(`role 非法：${String(role)}`);
    }
    if (reason !== undefined && typeof reason !== "string") throw new Error("reason 类型非法");
    out.push(reason === undefined ? { companyId, role: role as EnrichVerdict["role"] } : { companyId, role: role as EnrichVerdict["role"], reason });
  }
  if (out.length === 0) throw new Error("裁决数组为空");
  return out;
}

// ---------- buildEnrichPrompt ----------

// bodyMd 超 4000 字符截断到 4000（spec09 2.1 硬性约定）
const BODY_MAX_CHARS = 4000;

export const ENRICH_SYSTEM_PROMPT =
  "你是中文 AI 行业的资深编辑，负责判断一条新闻条目的主导公司。" +
  "只输出一个 JSON 对象，禁止输出任何解释、前后缀或多余文本。" +
  '输出格式：{"primary_company_id": "<候选 id>", "reason": "<一句中文裁决理由>"}，' +
  "primary_company_id 必须从候选清单的 id 中选择；" +
  "若条目主体公司不在候选清单中，primary_company_id 返回 null（reason 仍必填）。";

export function buildEnrichPrompt(
  item: EnrichItem,
  candidates: EnrichCandidate[],
): { system: string; user: string } {
  const body =
    item.bodyMd.length > BODY_MAX_CHARS ? item.bodyMd.slice(0, BODY_MAX_CHARS) : item.bodyMd;
  const candidateLines = candidates
    .map(
      (c) =>
        `- ${c.id}｜${c.name}｜${c.notes}｜命中：${
          c.evidence.length > 0 ? c.evidence.join("、") : "（无记录）"
        }`,
    )
    .join("\n");
  const user =
    `## 新闻条目\n` +
    `标题：${item.title}\n` +
    `摘要：${item.summary}\n` +
    `正文：\n${body}\n\n` +
    `## 候选公司（附命中别名证据）\n${candidateLines}\n\n` +
    `## 任务\n` +
    `上述条目的主导公司是哪一家？（被对比、被连接、被顺带提及的候选不是主导；` +
    `主体公司不在候选清单时 primary_company_id 返回 null。）` +
    `只输出 JSON：{"primary_company_id": "候选 id 或 null", "reason": "一句中文裁决理由"}`;
  return { system: ENRICH_SYSTEM_PROMPT, user };
}

// ---------- parseEnrichResponse ----------

// 剥 ```json 围栏（可有可无，须成对闭合）→ JSON.parse → 校验 reason 为非空字符串、primary 为
// 候选 id 或 null → 返回；任何不合法（非法 JSON / 幻觉 id / 缺 reason / primary 非字符串非 null /
// 围栏残缺）→ null。两条路径可区分（spec16 决策 1）：合法无主导 → { primaryId: null, reason }，
// 解析失败 → null。
export function parseEnrichResponse(
  raw: string,
  candidateIds: string[],
): { primaryId: string | null; reason: string } | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const text = fenced ? fenced[1] : raw;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const primary = record.primary_company_id;
  const reason = record.reason;
  if (typeof reason !== "string" || reason.trim() === "") return null; // 缺 reason / 空串 / 纯空白
  if (primary === null) return { primaryId: null, reason }; // 合法无主导：候选清单里没有主角
  if (typeof primary !== "string") return null; // 缺字段 / 类型不对
  if (!candidateIds.includes(primary)) return null; // 幻觉 id
  return { primaryId: primary, reason };
}

// ---------- deriveRoles ----------

// evidence 别名（大小写不敏感）是否出现在 text 中
function evidenceHitsText(evidence: string[], text: string): boolean {
  const lower = text.toLowerCase();
  return evidence.some((alias) => lower.includes(alias.toLowerCase()));
}

// 其余候选：title 命中 → partner；仅 body 命中（或无命中记录）→ subject。
// 命中位置优先取调用方标注（hitInTitle/hitInBody），缺省按 evidence 对 item 重扫。
// 产出数组 primary 在首位（enrich_cache.result 的 $[0] 即 primary），其余保持候选原序。
export function deriveRoles(
  item: EnrichItem,
  candidates: EnrichCandidate[],
  primaryId: string,
  primaryReason?: string,
): EnrichVerdict[] {
  const primary = candidates.find((c) => c.id === primaryId);
  const rest = candidates.filter((c) => c.id !== primaryId);
  const others = rest.map((c) => {
    const titleHit = c.hitInTitle ?? evidenceHitsText(c.evidence, item.title);
    return { companyId: c.id, role: titleHit ? ("partner" as const) : ("subject" as const) };
  });
  if (primary === undefined) return others; // 调用方契约保证 primary ∈ candidates；防御不抛
  return [{ companyId: primary.id, role: "primary", reason: primaryReason }, ...others];
}

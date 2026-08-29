// propose 纯函数（spec09 Step 3.1：missing_owner 条目的三分类判别，为白名单提议候选公司）。
// 纯函数：无 fetch / fs / process（ADR-0011 只测纯函数，真实调用在 scripts/propose-companies.ts 薄胶水里）。
// 位置说明：放 src/lib/llm/ 而非 worker/，spec10 审核页将复用同一套判别逻辑（票 03 2026-08-29 修订）。
// 纪律：LLM 只提议，永不直接改白名单——本模块只产出建议值，入册由人工完成。

// ---------- 类型 ----------

export interface ProposeItem {
  title: string;
  summary: string;
  bodyMd: string;
}

// 三分类裁决：①新公司建议入册 ②在册公司的产品/子品牌（提示可加 alias）③无关实体。
// company 分支的 id/name/aliases 均为 LLM 建议值，最终由人工审。
export type ProposeVerdict =
  | { kind: "company"; id: string; name: string; aliases: string[]; evidence: string }
  | { kind: "product"; parent: string; evidence: string }
  | { kind: "ignore" };

// ---------- buildProposePrompt ----------

// bodyMd 超 4000 字符截断到 4000（与 enrich 同款硬性约定，spec09 3.1）
const BODY_MAX_CHARS = 4000;

export const PROPOSE_SYSTEM_PROMPT =
  "你是中文 AI 行业的资深编辑，负责甄别新闻条目中的公司实体，为白名单挑出值得入册的新公司。" +
  "只输出一个 JSON 对象，禁止输出任何解释、前后缀或多余文本。" +
  "对条目主体做三分类判别：" +
  '①活跃的科技/AI 公司且不在在册清单 → {"kind":"company","id":"<建议英文小写 slug>","name":"<规范名>","aliases":["<别名，含官方产品名>"],"evidence":"<一句中文证据>"}；' +
  '②已入册公司的产品/子品牌/模型 → {"kind":"product","parent":"<在册公司名，只能从在册清单选>","evidence":"<一句中文证据>"}；' +
  '③无关实体（人名/论文/会议/地名/奖项等）→ {"kind":"ignore"}。';

export function buildProposePrompt(
  item: ProposeItem,
  registryNames: string[],
): { system: string; user: string } {
  const body =
    item.bodyMd.length > BODY_MAX_CHARS ? item.bodyMd.slice(0, BODY_MAX_CHARS) : item.bodyMd;
  const user =
    `## 新闻条目\n` +
    `标题：${item.title}\n` +
    `摘要：${item.summary}\n` +
    `正文：\n${body}\n\n` +
    `## 在册公司清单（parent 只能从中选择；条目主体若已是下列公司或其已入册产品，不得提议为新公司）\n` +
    `${registryNames.join("、")}\n\n` +
    `## 任务\n` +
    `判断条目主体属于哪一类，只输出 JSON：\n` +
    `- 新的活跃科技/AI 公司（不在在册清单）→ {"kind":"company","id":"英文小写 slug","name":"规范名","aliases":["别名，含官方产品名"],"evidence":"一句中文证据（公司定位与关键产品名）"}\n` +
    `- 在册公司的产品/子品牌 → {"kind":"product","parent":"在册公司名（从清单选）","evidence":"一句中文证据"}\n` +
    `- 无关实体（人名/论文/会议/地名等）→ {"kind":"ignore"}`;
  return { system: PROPOSE_SYSTEM_PROMPT, user };
}

// ---------- parseProposeResponse ----------

const RE_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/; // 小写字母数字段、单连字符分隔（与 gen-registry 同规则）

// 剥 ```json 围栏（可有可无，须成对闭合）→ JSON.parse → 按 kind 校验：
// company：id 必须为合法 slug、name 非空（aliases 缺省容忍为 []，非数组则不合法）；
// product：parent 必须 ∈ registryNames（幻觉 parent 不可信 → null）；
// ignore：直接过。evidence（company/product）须为非空字符串。
// 任何不合法（非法 JSON / 缺字段 / kind 未知 / 围栏残缺）→ null。
export function parseProposeResponse(raw: string, registryNames: string[]): ProposeVerdict | null {
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
  const kind = record.kind;
  if (typeof kind !== "string") return null; // 缺 kind
  if (kind === "ignore") return { kind: "ignore" };
  const evidence = record.evidence;
  if (typeof evidence !== "string" || evidence.trim() === "") return null; // 缺证据 / 纯空白
  if (kind === "company") {
    const id = record.id;
    const name = record.name;
    if (typeof id !== "string" || !RE_SLUG.test(id)) return null; // id 非 slug
    if (typeof name !== "string" || name.trim() === "") return null; // name 空
    const aliasesRaw = record.aliases;
    let aliases: string[] = [];
    if (aliasesRaw !== undefined) {
      if (!Array.isArray(aliasesRaw)) return null;
      aliases = aliasesRaw.filter((a): a is string => typeof a === "string" && a.trim() !== "");
    }
    return { kind: "company", id, name, aliases, evidence };
  }
  if (kind === "product") {
    const parent = record.parent;
    if (typeof parent !== "string") return null;
    const trimmed = parent.trim();
    if (!registryNames.includes(trimmed)) return null; // 幻觉 parent
    return { kind: "product", parent: trimmed, evidence };
  }
  return null; // kind 未知
}

// review-yaml — spec10 票 03：候选公司 → data/companies.yaml 追加片段（纯函数，ADR-0011 进 vitest）。
// 「复制 YAML」把片段交到剪贴板，由人工粘贴进 data/companies.yaml 后走 gen:registry 入册仪式；
// 本模块只产出片段文本，不读写任何文件。
// 形状约定：
// - 单引号包裹 + 内部单引号翻倍转义（与 scripts/propose-companies.ts 的 yq 同款）；
// - 键序 id/name/aliases/color/status/notes；候选不携带 color/status/notes → 占位缺省
//   （color 中性灰 #888888 过 6 位 hex 校验、status active、notes 空串，入册时可人工修订）；
// - aliases 兜底并入 name（registry 校验要求 aliases 非空，且匹配层只认 aliases 不认 name），
//   与 data/companies.yaml 存量条目「首条别名 = 规范名」的惯例一致。

export interface CandidateYamlInput {
  id: string;
  name: string;
  aliases: string[];
}

const COLOR_PLACEHOLDER = "#888888";
const STATUS_PLACEHOLDER = "active";

// YAML 单引号标量：内部单引号翻倍转义
function yq(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

export function candidateYamlSnippet(c: CandidateYamlInput): string {
  // name 恒在首位（按大小写不敏感去重），其余别名保持输入序
  const aliases = [c.name, ...c.aliases.filter((a) => a.toLowerCase() !== c.name.toLowerCase())];
  const lines = [
    `  - id: ${yq(c.id)}`,
    `    name: ${yq(c.name)}`,
    "    aliases:",
    ...aliases.map((a) => `      - ${yq(a)}`),
    `    color: ${yq(COLOR_PLACEHOLDER)}`,
    `    status: ${yq(STATUS_PLACEHOLDER)}`,
    `    notes: ${yq("")}`,
  ];
  return lines.join("\n") + "\n";
}

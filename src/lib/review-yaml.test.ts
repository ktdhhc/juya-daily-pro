// review-yaml TDD 测试（spec10 票 03）：候选公司 → data/companies.yaml 追加片段纯函数。
// 覆盖：键序与缩进 / 单引号翻倍转义 / aliases 并入 name 去重与空表兜底 / 缺省占位 / 行尾换行。
import { describe, expect, it } from "vitest";
import { candidateYamlSnippet } from "./review-yaml";

describe("candidateYamlSnippet（spec10 审核页「复制 YAML」）", () => {
  it("1. 键序 id/name/aliases/color/status/notes，缩进与 companies.yaml 条目一致，行尾带换行", () => {
    const out = candidateYamlSnippet({ id: "mistral", name: "Mistral AI", aliases: ["Le Chat"] });
    expect(out).toBe(
      [
        "  - id: 'mistral'",
        "    name: 'Mistral AI'",
        "    aliases:",
        "      - 'Mistral AI'",
        "      - 'Le Chat'",
        "    color: '#888888'",
        "    status: 'active'",
        "    notes: ''",
      ].join("\n") + "\n",
    );
  });

  it("2. 单引号翻倍转义（YAML 单引号风格，同 propose-companies yq）", () => {
    const out = candidateYamlSnippet({ id: "o-neil", name: "O'Neil Labs", aliases: ["O'Neil"] });
    expect(out).toContain("name: 'O''Neil Labs'");
    expect(out).toContain("- 'O''Neil'");
    expect(out).toContain("id: 'o-neil'");
  });

  it("3. aliases 已含 name（任意位置、任意大小写）时不重复，name 恒在首位", () => {
    const out = candidateYamlSnippet({
      id: "mistral",
      name: "Mistral AI",
      aliases: ["Le Chat", "mistral ai"],
    });
    // 列表项里 name 只出现一次（name: 行不计）
    expect(out.match(/- 'Mistral AI'/gi)).toHaveLength(1);
    expect(out.indexOf("- 'Mistral AI'")).toBeLessThan(out.indexOf("- 'Le Chat'"));
  });

  it("4. aliases 为空 → 兜底为 [name]（registry 校验要求 aliases 非空，匹配层只认 aliases）", () => {
    const out = candidateYamlSnippet({ id: "mistral", name: "Mistral AI", aliases: [] });
    expect(out).toContain("    aliases:\n      - 'Mistral AI'\n");
  });

  it("5. 值内冒号 / # / 中文等特殊字符在单引号标量内原样安全", () => {
    const out = candidateYamlSnippet({ id: "baidu", name: "Baidu: AI 集#团", aliases: ["百度"] });
    expect(out).toContain("name: 'Baidu: AI 集#团'");
    expect(out).toContain("- '百度'");
  });
});

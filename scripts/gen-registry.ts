// gen-registry — data/companies.yaml（真相源，ADR-0001）→ worker/registry.generated.ts 编译器（spec02 3.2）。
// 流程：读 yaml → validateRegistry 纯校验（问题逐条列出，非 0 退出）→ 生成类型化 REGISTRY。
// validateRegistry 为纯函数（无 fs/process），供 scripts/gen-registry.test.ts 直接测试（ADR-0011）。
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import type { Company } from "../src/lib/schema";

// ---------- 校验 ----------

const RE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/; // 小写字母数字段、单连字符分隔
const RE_HEX_COLOR = /^#[0-9a-fA-F]{6}$/; // 6 位 hex（data 现状即 6 位）
const STATUSES = ["active", "dormant", "retired"] as const;

const isTrimmedNonEmpty = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

// 校验 companies 数组，返回问题清单（每条带 companies[<i>] 定位）；空数组 = 合法。
export function validateRegistry(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [`输入必须为数组（companies 顶层键），实际为 ${typeName(input)}`];
  }
  const problems: string[] = [];
  const seenIds = new Map<string, number>(); // id → 首次出现下标

  input.forEach((entry, i) => {
    const at = `companies[${i}]`;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      problems.push(`${at} 必须为对象，实际为 ${typeName(entry)}`);
      return;
    }
    const c = entry as Record<string, unknown>;

    // id：slug 格式
    if (typeof c.id !== "string" || !RE_SLUG.test(c.id)) {
      problems.push(`${at} (${String(c.id)}): id 必须为 slug（小写字母数字与单连字符），实际 ${JSON.stringify(c.id) ?? "undefined"}`);
    } else if (seenIds.has(c.id)) {
      problems.push(`${at} (${c.id}): id 重复，首次出现于 companies[${seenIds.get(c.id)}]`);
    } else {
      seenIds.set(c.id, i);
    }

    // name：非空
    if (!isTrimmedNonEmpty(c.name)) {
      problems.push(`${at} (${String(c.id)}): name 必须为非空字符串`);
    }

    // aliases：非空字符串数组，元素非空
    if (!Array.isArray(c.aliases) || c.aliases.length === 0) {
      problems.push(`${at} (${String(c.id)}): aliases 必须为非空数组`);
    } else {
      c.aliases.forEach((a, j) => {
        if (!isTrimmedNonEmpty(a)) {
          problems.push(`${at} (${String(c.id)}): aliases[${j}] 必须为非空字符串，实际 ${JSON.stringify(a) ?? "undefined"}`);
        }
      });
    }

    // color：6 位 hex
    if (typeof c.color !== "string" || !RE_HEX_COLOR.test(c.color)) {
      problems.push(`${at} (${String(c.id)}): color 必须为 6 位 hex（#RRGGBB），实际 ${JSON.stringify(c.color) ?? "undefined"}`);
    }

    // status：枚举
    if (typeof c.status !== "string" || !(STATUSES as readonly string[]).includes(c.status)) {
      problems.push(`${at} (${String(c.id)}): status 必须为 ${STATUSES.join("|")}，实际 ${JSON.stringify(c.status) ?? "undefined"}`);
    }
  });

  return problems;
}

function typeName(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

// ---------- 生成 ----------

function renderRegistry(companies: Company[]): string {
  // JSON.stringify 输出即合法 TS 字面量（含中文/正则反斜杠的确定性转义），上下文类型收敛到 Company。
  const body = JSON.stringify(companies, null, 2);
  return (
    "// 由 `npm run gen:registry` 从 data/companies.yaml 生成（spec02 3.2，真相源 ADR-0001）。勿手改。\n" +
    'import type { Company } from "../src/lib/schema";\n' +
    "\n" +
    `export const REGISTRY: Company[] = ${body};\n`
  );
}

function main(): void {
  const yamlText = readFileSync(new URL("../data/companies.yaml", import.meta.url), "utf8");
  const doc = parse(yamlText) as { companies?: unknown };
  if (!Array.isArray(doc?.companies)) {
    console.error('gen-registry: data/companies.yaml 缺少顶层 `companies` 数组');
    process.exit(1);
  }

  const problems = validateRegistry(doc.companies);
  if (problems.length > 0) {
    console.error(`gen-registry: 校验失败，${problems.length} 个问题：`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  const companies = doc.companies as Company[];
  const outPath = new URL("../worker/registry.generated.ts", import.meta.url);
  writeFileSync(outPath, renderRegistry(companies), "utf8");
  console.log(`gen-registry: worker/registry.generated.ts 已生成（${companies.length} 家公司）`);
}

// 直接运行（npm run gen:registry / tsx）时执行；被 vitest import 时不触发副作用。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

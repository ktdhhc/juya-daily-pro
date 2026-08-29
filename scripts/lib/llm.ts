// llm — spec09 Step 1：enrich 与 propose 两个离线作业共用的 LLM 接入层（唯一出入口）。
// 纯函数 parseEnvText / resolveLlmConfig 由 llm.test.ts 单测；loadLlmConfig 只做读文件的
// 薄组合；chatJson / runWithLimiter 为薄 IO，不单测（ADR-0011：单测一律不调真实 LLM）。
// spec10 Step 2.1：chatJson / runWithLimiter / LlmConfig 已提取至 src/lib/llm/chat.ts
//（零 node 依赖，Worker 解析段共用），本文件 re-export——scripts 侧调用方零改动。
// 纪律：任何路径都不打印配置值（含 key），报错只出现键名。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { varFromWranglerConfig } from "./wrangler-cli";
import type { LlmConfig } from "../../src/lib/llm/chat";

export { chatJson, runWithLimiter } from "../../src/lib/llm/chat";
export type { LlmConfig } from "../../src/lib/llm/chat";

// 仓库根：本文件位于 scripts/lib/，上跳两级（与 wrangler-cli.ts 同指一处）。
const ROOT = fileURLToPath(new URL("../..", import.meta.url));

// ---------- 配置解析（纯函数） ----------

// .env 文本 → 键值映射：逐行 KEY=VALUE，跳过空行与 # 注释行（含缩进），
// 剥离值首尾成对引号。手写解析，不引依赖。
export function parseEnvText(text: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue; // 无 = 或键为空 → 跳过
    const key = line.slice(0, eq).trim();
    map[key] = stripQuotes(line.slice(eq + 1).trim());
  }
  return map;
}

// 剥离值首尾成对引号（单/双）；不配对则原样返回。
function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

// 纯函数解析（可测核心）：.env 值优先，缺失回退 wrangler vars；key 无回退。
// 任何必填项缺失 → throw（消息含「检查 .env」，对应 spec09 1.2 的报错退出约定）。
export function resolveLlmConfig(
  envMap: Record<string, string>,
  wranglerVars: Record<string, string>,
): LlmConfig {
  // 空串 / 纯空白视为缺失（.env 里 KEY= 与键缺失同义）
  const pick = (map: Record<string, string>, key: string): string | undefined => {
    const v = map[key];
    return v !== undefined && v.trim() !== "" ? v.trim() : undefined;
  };

  const baseUrl = pick(envMap, "LLM_BASE_URL") ?? pick(wranglerVars, "LLM_API_BASE");
  const model = pick(envMap, "MODEL_NAME") ?? pick(wranglerVars, "LLM_MODEL");
  const apiKey = pick(envMap, "LLM_API_KEY"); // key 无回退

  if (apiKey === undefined) {
    throw new Error("缺少 LLM API key（检查 .env：LLM_API_KEY，无回退）");
  }
  if (baseUrl === undefined) {
    throw new Error("缺少 LLM baseUrl（检查 .env：LLM_BASE_URL，或 wrangler.jsonc vars 的 LLM_API_BASE）");
  }
  if (model === undefined) {
    throw new Error("缺少 LLM model（检查 .env：MODEL_NAME，或 wrangler.jsonc vars 的 LLM_MODEL）");
  }
  return { baseUrl, model, apiKey };
}

// 薄组合：读仓库根 .env（缺失 → throw）+ wrangler.jsonc vars（复用 varFromWranglerConfig，
// fallback 空串即「未配置」，交给 resolveLlmConfig 裁决）。
export function loadLlmConfig(): LlmConfig {
  let envText: string;
  try {
    envText = readFileSync(path.join(ROOT, ".env"), "utf8");
  } catch {
    throw new Error("读不到 .env（检查 .env：需要 LLM_BASE_URL / MODEL_NAME / LLM_API_KEY）");
  }
  const wranglerVars: Record<string, string> = {
    LLM_API_BASE: varFromWranglerConfig("LLM_API_BASE", ""),
    LLM_MODEL: varFromWranglerConfig("LLM_MODEL", ""),
  };
  return resolveLlmConfig(parseEnvText(envText), wranglerVars);
}

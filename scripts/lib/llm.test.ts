// llm 接入层纯函数测试（spec09 Step 1，TDD 先红后绿）。
// 只测 parseEnvText / resolveLlmConfig 两个纯函数；loadLlmConfig（读文件薄组合）与
// chatJson / runWithLimiter（薄 IO）不单测（ADR-0011：单测一律不调真实 LLM）。
// 纪律：本文件不读仓库 .env，全部用注入文本验证；用例里的值均为虚构。
import { describe, expect, it } from "vitest";
import { chatJson as chatJsonDirect, runWithLimiter as limiterDirect } from "../../src/lib/llm/chat";
import { chatJson, parseEnvText, resolveLlmConfig, runWithLimiter } from "./llm";

describe("re-export（spec10 2.1：chatJson/runWithLimiter 提取至 src/lib/llm/chat 后的转发断言）", () => {
  it("chatJson / runWithLimiter 与 src/lib/llm/chat 同一实现（零改动转发）", () => {
    expect(chatJson).toBe(chatJsonDirect);
    expect(runWithLimiter).toBe(limiterDirect);
  });
});

describe("parseEnvText", () => {
  it("逐行 KEY=VALUE 解析", () => {
    expect(parseEnvText("A=1\nB=2")).toEqual({ A: "1", B: "2" });
  });

  it("值首尾引号剥离（单引号与双引号）", () => {
    const text = 'A="https://env.example/v1"\nB=\'env-model\'';
    expect(parseEnvText(text)).toEqual({ A: "https://env.example/v1", B: "env-model" });
  });

  it("空行与 # 注释行跳过（含缩进注释）", () => {
    const text = "\n# 整行注释\nA=1\n   \n  # 缩进注释\nB=2";
    expect(parseEnvText(text)).toEqual({ A: "1", B: "2" });
  });
});

describe("resolveLlmConfig", () => {
  const wranglerVars = { LLM_API_BASE: "https://wrangler.example/v1", LLM_MODEL: "wrangler-model" };

  it(".env 值优先于 wrangler vars", () => {
    const envMap = { LLM_BASE_URL: "https://env.example/v1", MODEL_NAME: "env-model", LLM_API_KEY: "k" };
    const cfg = resolveLlmConfig(envMap, wranglerVars);
    expect(cfg.baseUrl).toBe("https://env.example/v1");
    expect(cfg.model).toBe("env-model");
    expect(cfg.apiKey).toBe("k");
  });

  it(".env 缺 baseUrl → 回退 wrangler LLM_API_BASE", () => {
    const envMap = { MODEL_NAME: "env-model", LLM_API_KEY: "k" };
    expect(resolveLlmConfig(envMap, wranglerVars).baseUrl).toBe("https://wrangler.example/v1");
  });

  it(".env 缺 model → 回退 wrangler LLM_MODEL", () => {
    const envMap = { LLM_BASE_URL: "https://env.example/v1", LLM_API_KEY: "k" };
    expect(resolveLlmConfig(envMap, wranglerVars).model).toBe("wrangler-model");
  });

  it("baseUrl 两侧皆缺 → throw 且消息含「检查 .env」", () => {
    const envMap = { MODEL_NAME: "env-model", LLM_API_KEY: "k" };
    expect(() => resolveLlmConfig(envMap, {})).toThrow("检查 .env");
  });

  it("model 两侧皆缺 → throw 且消息含「检查 .env」", () => {
    const envMap = { LLM_BASE_URL: "https://env.example/v1", LLM_API_KEY: "k" };
    expect(() => resolveLlmConfig(envMap, {})).toThrow("检查 .env");
  });

  it("key 缺失 → throw 且消息含「检查 .env」（key 无回退，wrangler 有值也救不了）", () => {
    const envMap = { LLM_BASE_URL: "https://env.example/v1", MODEL_NAME: "env-model" };
    expect(() => resolveLlmConfig(envMap, wranglerVars)).toThrow("检查 .env");
  });
});

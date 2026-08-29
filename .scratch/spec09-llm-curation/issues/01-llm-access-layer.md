# 01 · LLM 接入层：loadLlmConfig / chatJson / runWithLimiter

Status: ready-for-agent

## What to build

按 `docs/spec/spec09-llm-curation.md` Step 1（1.1→1.2）执行。为 enrich 与 propose 两个离线作业提供唯一 LLM 出入口。**单测一律不调真实 LLM**（ADR-0011）。

### 1.1 `scripts/lib/llm.ts` 三件套

**`loadLlmConfig(): LlmConfig`**（纯 IO，可测）
- 读仓库根 `.env`：简单键值解析（逐行 `KEY=VALUE`，去引号、去空行注释），**不引依赖**。已知键名：`LLM_BASE_URL` / `MODEL_NAME` / `LLM_API_KEY`。
- 映射：`baseUrl = .env LLM_BASE_URL`，缺失回退 wrangler.jsonc vars `LLM_API_BASE`；`model = .env MODEL_NAME`，缺失回退 wrangler.jsonc `LLM_MODEL`；`apiKey = .env LLM_API_KEY` **无回退**。
- `.env` 缺失或 key 缺失 → throw Error，消息含「检查 .env」字样。
- wrangler.jsonc 读取复用 `scripts/backfill.ts` 的 `varFromWranglerConfig` 模式（正则取 vars 段字符串值）。
- **TDD**：`scripts/lib/llm.test.ts` 用「注入路径」方式测——`loadLlmConfig` 拆成 `parseEnvText(text): Record<string,string>` + `resolveLlmConfig(envMap, wranglerVars): LlmConfig` 两个纯函数导出，`loadLlmConfig` 是薄组合。测试用例：.env 优先 / .env 缺 baseUrl 落 wrangler / 两者都缺 model 落默认？不——wrangler vars 已有值则用 wrangler，两者皆缺则 throw / key 缺失 throw 含「检查 .env」/ 值带引号剥离。先红后绿（你没有 skill，按：先写测试→跑出失败→实现→跑绿→贴两段证据）。

**`chatJson(cfg, system, user): Promise<string>`**（薄 IO，不单测）
- POST `${baseUrl}/chat/completions`，body: `{ model, messages: [{role:"system",content:system},{role:"user",content:user}], response_format: { type: "json_object" } }`，header `Authorization: Bearer <apiKey>`。
- 429 / 5xx 退避重试 1 次（sleep 1500ms）；两次仍失败 throw（消息含状态码）。
- 返回 `choices[0].message.content` 字符串。30s 超时（AbortSignal.timeout）。

**`runWithLimiter<T>(jobs: (() => Promise<T>)[], max: number): Promise<T[]>`**
- 固定并发池（参考 `scripts/backfill.ts` mapPool 同构实现），保序返回。

### 1.2 回归确认

`npm run sync` 等既有脚本不受影响（本票不改它们；跑一次 `npx vitest run` 全量确认无回归即可，不必真跑 sync 抓取）。

## 红线

- 禁止 git commit / git add。
- 只允许改动：`scripts/lib/llm.ts`（新建）、`scripts/lib/llm.test.ts`（新建）。其他文件一律不碰。
- **禁止打印 .env 内容与任何 key 值**（汇报里只允许出现键名）。
- 不新增 npm 依赖；TS strict；中文注释对齐 scripts/ 现有风格。

## Acceptance criteria

- [ ] parseEnvText / resolveLlmConfig 纯函数单测红→绿证据
- [ ] `npx vitest run scripts/lib/llm.test.ts` 绿；`npx tsc --noEmit` 绿（worker tsconfig 不受影响可不跑，主 tsconfig 必须绿）
- [ ] 汇报含 resolveLlmConfig 的映射表（.env 键 → 配置字段 → 回退链）

## Blocked by

None - can start immediately

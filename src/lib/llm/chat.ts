// chat — spec10 Step 2.1：LLM 接入共享层，从 scripts/lib/llm.ts 提取（chatJson / runWithLimiter / LlmConfig 原样迁出）。
// 供离线脚本（scripts/enrich.ts / scripts/propose-companies.ts，经 scripts/lib/llm.ts re-export）
// 与 Worker 解析段（worker/api/parse.ts）共用同一出入口。
// 零 node 依赖（无 node:fs / node:path / node:url）：fetch 与 AbortSignal.timeout 在 Node 18+ 与
// workerd 均原生可用——已实测核验（2026-08-29，wrangler dev 临时实例，compatibility_date 2026-07-01：
// typeof AbortSignal.timeout === "function"，携带 AbortSignal.timeout(8000) 的出站 fetch 返回 HTTP 200），
// 故零改动共享成立，无需 Worker 等价实现。
// 纪律：任何路径都不打印配置值（含 key），报错只出现状态码/键名。

export interface LlmConfig {
  baseUrl: string; // 形如 https://host/v1，chatJson 在其后拼 /chat/completions
  model: string;
  apiKey: string;
}

// 单次 LLM 请求超时与 429/5xx 退避间隔。90s：推理型模型（先 reasoning_content 后答案）
// 在候选多、推理链长时 30s 不够（2026-08-29 全量回填实测：323 条中 2 条稳定超时）。
const CHAT_TIMEOUT_MS = 90_000;
const RETRY_DELAY_MS = 1_500;

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

// POST <base>/chat/completions：response_format json_object，Bearer 鉴权，
// 429/5xx 与超时/网络错误退避重试 1 次，两次仍失败 throw（消息含状态码）。返回首条消息内容字符串。
export async function chatJson(cfg: LlmConfig, system: string, user: string): Promise<string> {
  const body = JSON.stringify({
    model: cfg.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
  });

  let status = 0;
  let lastNetworkError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${cfg.apiKey}`,
        },
        body,
        signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
      });
    } catch (err) {
      // 超时 / 网络不可达：瞬时类失败，退避重试 1 次（确定性 400 等响应类错误不重试）
      lastNetworkError = err instanceof Error ? err.message : String(err);
      status = 0;
      if (attempt === 1) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      break;
    }
    if (res.ok) {
      const data = (await res.json()) as ChatResponse;
      const content = data.choices?.[0]?.message?.content;
      if (content === undefined) {
        throw new Error("LLM 响应缺少 choices[0].message.content");
      }
      return content;
    }
    status = res.status;
    // 仅 429 / 5xx 退避重试 1 次；其余状态码直接失败
    if (attempt === 1 && (status === 429 || status >= 500)) {
      await sleep(RETRY_DELAY_MS);
      continue;
    }
    break;
  }
  if (status === 0) throw new Error(`LLM 请求失败：${lastNetworkError}`);
  throw new Error(`LLM 请求失败：HTTP ${status}`);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ---------- runWithLimiter（薄 IO 编排，不单测） ----------

// 固定并发池（与 scripts/backfill.ts mapPool 同构）：按 next++ 依序领取，结果按下标
// 回填，保持与输入同序返回。单个 job 抛错即整体 reject，由调用方在 job 内自行兜底。
export async function runWithLimiter<T>(
  jobs: Array<() => Promise<T>>,
  max: number,
): Promise<T[]> {
  const results: T[] = new Array(jobs.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(max, jobs.length) }, async () => {
    while (next < jobs.length) {
      const i = next++;
      results[i] = await jobs[i]();
    }
  });
  await Promise.all(workers);
  return results;
}

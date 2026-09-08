// Pages 同域代理（spec15 票 05 / 缝 3）：把 /api/* 同域转发到 Worker origin。
// - origin 由 Pages 项目变量 WORKER_ORIGIN 注入（本地 pages dev 用 --binding WORKER_ORIGIN=...）；
// - 透传 method / headers / body，原样返回上游状态码与响应体（不改写）；
// - 静态资源不进本函数（public/_routes.json 只 include /api/*）；
// - 配置缺失 / 非法 / 上游不可达 → 502 + 统一错误格式 { error: { code, message } }（避免白屏）。
// 类型说明：本文件落在 root tsconfig 程序内（DOM lib）。不能引 @cloudflare/workers-types——
// 其全局 Request/Response 声明与 DOM lib 冲突（同 worker/tsconfig.json 注释），故用最小本地类型声明。
import { isApiPath } from "../lib/api-path";

/** Pages 项目变量（仅用到 WORKER_ORIGIN） */
type ProxyEnv = {
  WORKER_ORIGIN?: string;
};

/** Pages Function 上下文最小子集：只消费 request 与 env */
type ProxyContext = {
  request: Request;
  env: ProxyEnv;
};

/** 与 worker/api/routes.ts 一致的错误形状：{ error: { code, message } } */
function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequest(context: ProxyContext): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);

  // ① 路径前缀校验（显式，防御纵深）：非 /api 命名空间一律拒绝，函数绝不成为开放代理
  if (!isApiPath(url.pathname)) {
    return jsonError(404, "not_found", `代理仅处理 /api/*，收到 ${url.pathname}`);
  }

  // ② origin 缺失 → 502 统一错误格式（部署日忘配 Pages 变量时给出明确提示）
  const origin = env.WORKER_ORIGIN;
  if (!origin) {
    return jsonError(
      502,
      "bad_gateway",
      "代理未配置：请在 Pages 项目变量中设置 WORKER_ORIGIN（Worker 源地址）",
    );
  }

  // ③ 目标 URL 只由「配置的 origin + 原 pathname/search」拼成：主机恒来自 env，请求路径无法影响（防 SSRF）
  let target: URL;
  try {
    target = new URL(url.pathname + url.search, origin);
  } catch (err) {
    // 不吞异常：部署日「origin 写错」与「上游不可达」必须能区分（console + 502 message 各带原因）
    console.error("[pages-proxy] WORKER_ORIGIN 非法：", err);
    return jsonError(
      502,
      "bad_gateway",
      "代理配置无效：WORKER_ORIGIN 必须是完整 URL（例如 https://api.example.com）",
    );
  }

  // 头部整体透传。注意：workerd 会给 fetch 子请求无条件注入 accept-encoding: br, gzip
  //（实测：客户端未声明编码 / 代码显式置 identity 均被覆盖），上游据此压缩、我们原样返回，
  // 因此响应可能带 Content-Encoding: br。浏览器均声明 br，语义不受影响；
  // 不做解压（Workers 无 br 解压能力），也不改写成别的编码（会破坏响应体）。
  const init: RequestInit = { method: request.method, headers: request.headers };
  // GET/HEAD 按 fetch 规范不能带 body，其余方法原样透传请求体
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (err) {
    // 同上：排障需要知道是 DNS / TLS / 连接被拒，不能只回一句「不可达」
    console.error("[pages-proxy] 上游不可达：", target.origin, err);
    const reason = err instanceof Error ? err.message : String(err);
    return jsonError(502, "bad_gateway", `上游不可达：Worker origin 无响应（${reason}）`);
  }

  // 原样返回上游响应：状态码 / 响应头 / 响应体均不改写
  return upstream;
}

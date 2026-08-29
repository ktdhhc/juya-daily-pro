// fetch-logos — 公司 Logo 拉取（npm run logos:fetch，本地 Node 直连外网，非 Worker 流程）。
// 每家按 unavatar → clearbit → google favicons 顺序尝试；content-type image/* 且 >500B 视为有效，
// 存 public/logos/<id>.<ext>，并生成 src/lib/logos.generated.ts（id → /logos/<file>，仅含成功公司）。
// 全失败公司只打印清单、不写任何文件——前端由 LogoSeal 回退首字方印。
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { parse } from "yaml";

interface CompanyDomain {
  id: string;
  name: string;
  domain: string;
}

type FetchResult = { ok: true; data: Buffer; contentType: string } | { ok: false; reason: string };

type Outcome =
  | { id: string; name: string; ok: true; file: string; source: string; data: Buffer }
  | { id: string; name: string; ok: false; detail: string };

const YAML_PATH = new URL("../data/companies.yaml", import.meta.url);
const LOGO_DIR = new URL("../public/logos/", import.meta.url);
const OUT_TS = new URL("../src/lib/logos.generated.ts", import.meta.url);

const SOURCES = [
  { name: "unavatar", url: (d: string) => `https://unavatar.io/${d}?fallback=false` },
  { name: "clearbit", url: (d: string) => `https://logo.clearbit.com/${d}` },
  { name: "google", url: (d: string) => `https://www.google.com/s2/favicons?domain=${d}&sz=128` },
] as const;

const EXT_BY_CTYPE: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/svg+xml": ".svg",
  "image/webp": ".webp",
  "image/avif": ".avif",
  "image/gif": ".gif",
  "image/x-icon": ".ico",
  "image/vnd.microsoft.icon": ".ico",
};

const MIN_BYTES = 500;
const TIMEOUT_MS = 15000;
const CONCURRENCY = 3;
// 网络抖动/服务端错误可重试；4xx 与校验失败是确定性结果，重试无意义
const RETRYABLE = /HTTP 5\d\d|TimeoutError|AbortError|aborted|fetch failed|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN/i;

async function attempt(url: string): Promise<FetchResult> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow",
      headers: { "user-agent": "juya-daily-logos/1.0" },
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const data = Buffer.from(await res.arrayBuffer());
    if (!contentType.startsWith("image/")) {
      return { ok: false, reason: `content-type ${contentType || "缺失"}` };
    }
    if (data.length <= MIN_BYTES) {
      return { ok: false, reason: `${data.length}B ≤ ${MIN_BYTES}B` };
    }
    return { ok: true, data, contentType };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? `${e.name} ${e.message}` : String(e) };
  }
}

/** 单一来源：初次 + 重试 1 次（最多 2 次尝试） */
async function trySource(url: string): Promise<FetchResult> {
  let last: FetchResult = { ok: false, reason: "unreachable" };
  for (let i = 0; i < 2; i++) {
    last = await attempt(url);
    if (last.ok || !RETRYABLE.test(last.reason)) return last;
  }
  return last;
}

async function fetchLogo(c: CompanyDomain): Promise<Outcome> {
  const tried: string[] = [];
  for (const src of SOURCES) {
    const r = await trySource(src.url(c.domain));
    if (r.ok) {
      const ext = EXT_BY_CTYPE[r.contentType] ?? ".png";
      return { id: c.id, name: c.name, ok: true, file: `${c.id}${ext}`, source: src.name, data: r.data };
    }
    tried.push(`${src.name}: ${r.reason}`);
  }
  return { id: c.id, name: c.name, ok: false, detail: tried.join("; ") };
}

function renderLogos(ok: Extract<Outcome, { ok: true }>[]): string {
  const entries = ok
    .map((o) => `  ${JSON.stringify(o.id)}: ${JSON.stringify(`/logos/${o.file}`)},`)
    .join("\n");
  return (
    "// 由 `npm run logos:fetch` 生成（scripts/fetch-logos.ts）。公司 id → /logos/<file>，仅含拉取成功的公司。\n" +
    "// 勿手改；重新生成会先清空 public/logos/。未入表的公司由 LogoSeal 回退首字方印。\n" +
    "export const LOGOS: Record<string, string> = {\n" +
    entries +
    "\n};\n"
  );
}

async function main(): Promise<void> {
  const doc = parse(readFileSync(YAML_PATH, "utf8")) as { companies?: Partial<CompanyDomain>[] };
  if (!Array.isArray(doc?.companies)) {
    console.error("fetch-logos: data/companies.yaml 缺少顶层 `companies` 数组");
    process.exit(1);
  }
  const companies = doc.companies
    .filter((c): c is CompanyDomain => typeof c.id === "string" && typeof c.domain === "string")
    .map((c) => ({ id: c.id, name: typeof c.name === "string" ? c.name : c.id, domain: c.domain }));
  console.log(`fetch-logos: 开始拉取 ${companies.length} 家公司 logo（并发 ${CONCURRENCY}，重试 1 次）`);

  // 并发 3 worker pool
  const outcomes: Outcome[] = [];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < companies.length) {
      const c = companies[cursor++];
      const o = await fetchLogo(c);
      outcomes.push(o);
      console.log(
        o.ok
          ? `  OK  ${o.id} ← ${o.source} (${o.file}, ${(o.data.length / 1024).toFixed(1)}KB)`
          : `  MISS ${o.id} — ${o.detail}`
      );
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const ok = outcomes.filter((o): o is Extract<Outcome, { ok: true }> => o.ok);
  const miss = outcomes.filter((o): o is Extract<Outcome, { ok: false }> => !o.ok);

  // 全部拉取完成后才落盘：先清空目录防旧文件/孤儿，再写入图片与生成物
  rmSync(LOGO_DIR, { recursive: true, force: true });
  mkdirSync(LOGO_DIR, { recursive: true });
  for (const o of ok) writeFileSync(new URL(o.file, LOGO_DIR), o.data);
  writeFileSync(OUT_TS, renderLogos(ok), "utf8");

  const dist = SOURCES.map((s) => `${s.name} ${ok.filter((o) => o.source === s.name).length}`).join(" / ");
  console.log(`\nfetch-logos: 成功 ${ok.length}/${companies.length}（来源分布 ${dist}）`);
  if (miss.length > 0) {
    console.log("失败清单（前端回退首字印）：");
    for (const m of miss) console.log(`  - ${m.id}（${m.name}）: ${m.detail}`);
  }
}

main().catch((e: unknown) => {
  console.error("fetch-logos:", e);
  process.exit(1);
});

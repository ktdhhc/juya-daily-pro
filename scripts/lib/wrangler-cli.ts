// wrangler-cli — 本地零登录执行 wrangler CLI 的共享工具（spec03 Step 3）。
// 自 scripts/backfill.ts 原样迁移 runWrangler / parseWranglerJson，供 backfill 与
// match-all 两个脚本复用；函数体逐行不变，仅 ROOT 的推导因目录深度少一级而调整
// （scripts/lib/ 上跳两级 = 仓库根，与迁移前同指一处，行为不变）。
// 缺省仅 --local（零 Cloudflare 登录）；显式 --remote 时连远端（需 wrangler 登录，spec15 缝 1）。
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// 仓库根：本文件位于 scripts/lib/，上跳两级；迁移前 backfill.ts（scripts/）上跳一级同指仓库根。
const ROOT = fileURLToPath(new URL("../..", import.meta.url));

export interface WranglerResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

// 数据库目标（spec15 缝 1）：缺省本地 --local（零登录开发流程不变）；显式 --remote 连远端。
export type DbTarget = "--local" | "--remote";

// 命令行目标解析（纯函数）：argv 含 --remote → 远端，否则本地（缺省）。
// 其他参数（--dates= / --limit= / --force / --item= 等）一律忽略，与出现位置无关。
export function parseDbTarget(argv: string[]): DbTarget {
  return argv.includes("--remote") ? "--remote" : "--local";
}

// 本地零登录执行 wrangler CLI：优先直跑本地 bin（node + wrangler.js，无 shell 转义歧义），
// 缺失时回退 `npx wrangler`（shell）。等价于 spec 的 `npx wrangler d1 execute --local`。
export function runWrangler(args: string[]): WranglerResult {
  const env = { ...process.env, WRANGLER_SEND_METRICS: "false" };
  const localBin = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
  if (existsSync(localBin)) {
    const r = spawnSync(process.execPath, [localBin, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
      env,
    });
    return { ok: r.status === 0, stdout: r.stdout ?? "", stderr: r.stderr ?? String(r.error ?? "") };
  }
  const shellArg = (a: string): string => (/\s/.test(a) ? `"${a}"` : a);
  const r = spawnSync(["npx", "wrangler", ...args.map(shellArg)].join(" "), {
    cwd: ROOT,
    shell: true,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    env,
  });
  return { ok: r.status === 0, stdout: r.stdout ?? "", stderr: r.stderr ?? String(r.error ?? "") };
}

// wrangler --json 输出可能混有横幅行：取首个 `[` 到最后一个 `]` 之间解析。
export function parseWranglerJson(stdout: string): unknown {
  const start = stdout.indexOf("[");
  const end = stdout.lastIndexOf("]");
  if (start < 0 || end <= start) {
    throw new Error(`wrangler --json 输出无法解析：${stdout.slice(0, 300)}`);
  }
  return JSON.parse(stdout.slice(start, end + 1));
}

// wrangler.jsonc vars 读取（自 scripts/backfill.ts 原样迁移共享，spec05 Step 3）：
// 读不到配置时回退 spec 默认值；仅匹配字符串值（ARCHIVE_URL / MD_BASE / SYNC_LOOKBACK_DAYS 均为字符串）。
export function varFromWranglerConfig(key: string, fallback: string): string {
  try {
    const text = readFileSync(path.join(ROOT, "wrangler.jsonc"), "utf8");
    const m = new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`).exec(text);
    if (m) return m[1];
  } catch {
    // 读不到配置时用 spec 默认值
  }
  return fallback;
}

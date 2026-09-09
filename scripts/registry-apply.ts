// registry-apply — spec16 票 04（ADR-0017 决策 5）：入册闭环命令（npm run registry:apply）。
// 编辑把候选公司写进 data/companies.yaml 后跑一次，一条命令串起四步：
//   ① npm run gen:registry      从 yaml 重新生成 registry（校验 + 写 src/lib/registry.generated.ts）
//   ② npm run sync             刷新 D1 公司镜像并做窗口重匹配
//   ③ npm run match:all        全量重匹配（覆盖窗口外历史条目）
//   ④ 候选状态回填              把"新 registry 里已存在"的待处置候选 UPDATE 为 registered（本脚本）
// 任一步失败即止并给出可读错误；**不触发解析**——改判主导交给下一轮定时任务或手动「运行解析」。
// 纯函数（selectCandidatesToRegister）供 scripts/registry-apply.test.ts 直接测试（ADR-0011）；
// 子进程编排属薄 IO 不单测，由本地实跑演练覆盖。
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { escapeSqlText } from "../worker/sync/sqlgen";
import { parseDbTarget, parseWranglerJson, runWrangler } from "./lib/wrangler-cli";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DB = "juya-daily";
// 数据库目标（spec15 缝 1）：缺省 --local 零登录；显式 --remote 连远端；透传给 ②③ 子步骤。
const DB_TARGET = parseDbTarget(process.argv.slice(2));

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------- 纯函数 ----------

// 候选回填判定（spec16 票 04）：给定新 registry 的公司 id 集合与待处置候选清单，
// 返回应标记为已入册的候选 id——只认 id 精确命中；不在 registry 的保持 pending；
// 输出保持输入顺序并去重。
export function selectCandidatesToRegister(
  registryIds: ReadonlySet<string>,
  pendingCandidateIds: readonly string[],
): string[] {
  const picked: string[] = [];
  for (const id of pendingCandidateIds) {
    if (registryIds.has(id) && !picked.includes(id)) picked.push(id);
  }
  return picked;
}

// ---------- 子步骤（薄 IO：npm script 顺序编排，ADR-0011 不单测） ----------

// 顺序执行一个 npm script（stdio 直通，子步骤自身摘要原样可见）。
// 返回 false = 该步失败（退出码非 0 或无法启动），调用方立即中止。
function runNpmScript(script: string, extraArgs: string[]): boolean {
  const args = ["run", script, ...(extraArgs.length > 0 ? ["--", ...extraArgs] : [])];
  console.log(`\n-- npm ${args.join(" ")}`);
  const r = spawnSync("npm", args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32", // Windows 的 npm 是 npm.cmd，需经 shell 解析
  });
  if (r.status !== 0) {
    console.error(
      `步骤失败：npm ${args.join(" ")}（退出码 ${r.status ?? "未启动"}）${r.error ? ` — ${errorMessage(r.error)}` : ""}`,
    );
    return false;
  }
  return true;
}

// ---------- 步骤 ④：候选状态回填 ----------

interface CandidateRow {
  id: string;
}

function queryPendingCandidateIds(): string[] {
  const r = runWrangler([
    "d1", "execute", DB, DB_TARGET, "--command",
    "SELECT id FROM company_candidates WHERE status IN ('pending','dismissed') ORDER BY id;", "--json",
  ]);
  if (!r.ok) throw new Error(`company_candidates 查询失败：${r.stderr.slice(-400)}`);
  const arr = parseWranglerJson(r.stdout) as Array<{ results?: CandidateRow[] }>;
  return (arr[0]?.results ?? []).map((c) => c.id);
}

// UPDATE 再带 status IN ('pending','dismissed') 条件：读取到写入之间候选被审核台处置时不覆盖其状态。
// 已忽略的候选也回填 registered（code-review P1）：人工把该公司写进白名单即视为态度改变，
// 回填后解析闸门解除，提及该公司的条目重新可判主导。
export function candidateRegisteredSql(ids: string[]): string {
  const values = ids.map((id) => `'${escapeSqlText(id)}'`).join(", ");
  return `UPDATE company_candidates SET status = 'registered' WHERE status IN ('pending','dismissed') AND id IN (${values});`;
}

// 临时 SQL 文件 → wrangler d1 execute --file → 删除（成功失败均清理，.wrangler gitignored），同 match-all 范式。
function executeSqlFile(statements: string[]): void {
  mkdirSync(path.join(ROOT, ".wrangler"), { recursive: true });
  const tmpPath = path.join(ROOT, ".wrangler", `tmp-registry-apply-${Date.now()}.sql`);
  writeFileSync(tmpPath, statements.join("\n") + "\n", "utf8");
  console.log(`SQL 文件: ${path.relative(ROOT, tmpPath)}（${statements.length} 条语句）`);
  const r = runWrangler(["d1", "execute", DB, DB_TARGET, "--file", path.relative(ROOT, tmpPath)]);
  rmSync(tmpPath, { force: true });
  if (!r.ok) {
    console.error("SQL 执行失败：");
    console.error(r.stderr.split(/\r?\n/).slice(-8).join("\n"));
    throw new Error("候选状态回填 SQL 执行失败");
  }
  console.log("SQL 执行成功");
}

// ---------- 主流程 ----------

async function main(): Promise<void> {
  console.log(`== registry:apply 开始（${new Date().toISOString()}，目标 ${DB_TARGET}）`);
  console.log("（本命令不触发解析：改判主导交给下一轮定时任务或手动「运行解析」。）");

  // ① 重新生成 registry：data/companies.yaml → src/lib/registry.generated.ts（校验不过即止）
  if (!runNpmScript("gen:registry", [])) {
    process.exitCode = 1;
    return;
  }

  // ② 刷新 D1 公司镜像（upsert/prune companies）并做窗口重匹配
  if (!runNpmScript("sync", [DB_TARGET])) {
    process.exitCode = 1;
    return;
  }

  // ③ 全量重匹配：覆盖窗口外的历史条目
  if (!runNpmScript("match:all", [DB_TARGET])) {
    process.exitCode = 1;
    return;
  }

  // ④ 候选状态回填：新 registry 里已存在的待处置候选 → registered。
  // 动态 import：静态 import 会在步骤 ① 之前求值，拿到旧 registry。
  const { REGISTRY } = await import("../src/lib/registry.generated");
  const registryIds = new Set(REGISTRY.map((c) => c.id));
  const pendingIds = queryPendingCandidateIds();
  const toRegister = selectCandidatesToRegister(registryIds, pendingIds);
  console.log(
    `\n候选回填判定: pending ${pendingIds.length} 条 → 命中新 registry ${toRegister.length} 条` +
      (toRegister.length > 0 ? `（${toRegister.join(", ")}）` : ""),
  );
  if (toRegister.length === 0) {
    console.log("无需回填，跳过写库");
  } else {
    executeSqlFile([candidateRegisteredSql(toRegister)]);
  }

  console.log("== registry:apply 完成 ==");
  console.log("提示：下一轮定时任务或手动「运行解析」会经已发布补救通道补判主次（本命令不触发解析）。");
}

// 直接运行（npm run registry:apply / tsx）时执行；被 vitest import 时不触发副作用。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(`registry:apply 失败: ${errorMessage(err)}`);
    process.exitCode = 1;
  });
}

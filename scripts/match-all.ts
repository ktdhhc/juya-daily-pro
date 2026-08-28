// match-all — spec03 Step 4.2：段一确定性匹配的本地 D1 胶水脚本。
// 流程：wrangler --json 读 companies + items（--local 零登录）→ matchAll 纯编排（worker/sync/match.ts）
// → itemCompaniesUpsertSql + enrichStateUpdateSql（worker/sync/sqlgen.ts）→ 临时 SQL 文件
// → `wrangler d1 execute --local --file` → 删除 → 打印统计。退出码语义同 backfill：有失败非 0。
// 全程零 LLM 调用、零 Cloudflare 登录。
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Company } from "../src/lib/schema";
import { matchAll } from "../worker/sync/match";
import { enrichStateUpdateSql, itemCompaniesUpsertSql } from "../worker/sync/sqlgen";
import { parseWranglerJson, runWrangler } from "./lib/wrangler-cli";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DB = "juya-daily";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------- D1 读取 ----------

interface CompanyRow {
  id: string;
  name: string;
  aliases: string; // JSON 字符串
  color: string;
  status: string;
  notes: string;
}

interface ItemRow {
  id: string;
  title: string;
  body_md: string;
  enrich_state: string;
}

function queryRows<T>(sql: string, label: string): T[] {
  const r = runWrangler(["d1", "execute", DB, "--local", "--command", sql, "--json"]);
  if (!r.ok) throw new Error(`${label} 查询失败：${r.stderr.slice(-400)}`);
  const arr = parseWranglerJson(r.stdout) as Array<{ results?: T[] }>;
  return arr[0]?.results ?? [];
}

// ---------- 主流程 ----------

async function main(): Promise<void> {
  console.log(`== match:all 开始（${new Date().toISOString()}，全程 --local 零登录）`);

  // 1) companies → Company[]（aliases 为 JSON 字符串需 parse）
  const companyRows = queryRows<CompanyRow>(
    "SELECT id, name, aliases, color, status, notes FROM companies ORDER BY id;",
    "companies",
  );
  const registry: Company[] = companyRows.map((c) => ({
    id: c.id,
    name: c.name,
    aliases: JSON.parse(c.aliases) as string[],
    color: c.color,
    status: c.status as Company["status"],
    notes: c.notes,
  }));
  console.log(`companies 读取: ${registry.length} 行`);

  // 2) items（1105 行，注意 maxBuffer——runWrangler 已设 128MB）→ 仅匹配所需字段 + id
  const itemRows = queryRows<ItemRow>(
    "SELECT id, title, body_md, enrich_state FROM items ORDER BY id;",
    "items",
  );
  const items = itemRows.map((it) => ({ id: it.id, title: it.title, bodyMd: it.body_md }));
  console.log(`items 读取: ${items.length} 行`);

  // 3) 段一匹配（纯编排）
  const { ownerRows, okIds, missingIds } = matchAll(items, registry);

  // 0/1/≥2 家命中分布：按 itemId 聚合 ownerRows 行数
  const perItemCount = new Map<string, number>();
  for (const row of ownerRows) {
    perItemCount.set(row.itemId, (perItemCount.get(row.itemId) ?? 0) + 1);
  }
  let oneOwner = 0;
  let multiOwner = 0;
  for (const n of perItemCount.values()) {
    if (n === 1) oneOwner++;
    else multiOwner++;
  }

  // 4) SQL 生成 → 临时文件 → wrangler d1 execute --local --file → 删除
  const statements = [
    itemCompaniesUpsertSql(ownerRows),
    enrichStateUpdateSql(okIds, missingIds),
  ].filter((s) => s !== "");

  if (statements.length === 0) {
    console.log("无任何匹配结果，跳过写库");
  } else {
    mkdirSync(path.join(ROOT, ".wrangler"), { recursive: true });
    const tmpPath = path.join(ROOT, ".wrangler", `tmp-match-${Date.now()}.sql`);
    writeFileSync(tmpPath, statements.join("\n") + "\n", "utf8");
    console.log(`SQL 文件: ${path.relative(ROOT, tmpPath)}（${statements.length} 条语句）`);
    const r = runWrangler(["d1", "execute", DB, "--local", "--file", path.relative(ROOT, tmpPath)]);
    rmSync(tmpPath, { force: true }); // 成功失败均清理（.wrangler gitignored）
    if (!r.ok) {
      console.error("SQL 执行失败：");
      console.error(r.stderr.split(/\r?\n/).slice(-8).join("\n"));
      process.exitCode = 1;
      return;
    }
    console.log("SQL 执行成功");
  }

  // 5) 统计打印
  console.log("== match:all 摘要 ==");
  console.log(`items: ${items.length}`);
  console.log(`companies(registry): ${registry.length}`);
  console.log(`ownerRows 行数: ${ownerRows.length}`);
  console.log(`命中分布: 0 家 = ${missingIds.length}，1 家 = ${oneOwner}，≥2 家 = ${multiOwner}`);
  console.log(`enrich_state: ok = ${okIds.length}，missing_owner = ${missingIds.length}`);
}

main().catch((err: unknown) => {
  console.error(`match:all 失败: ${errorMessage(err)}`);
  process.exitCode = 1;
});

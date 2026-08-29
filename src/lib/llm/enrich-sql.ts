// enrich-sql — spec09 Step 2.3：enrich 作业写库 SQL 生成的纯函数（不进同步关键路径）。
// 转义与 SQL 纪律复用 worker/sync/sqlgen（单语句单行、`;` 结尾、escapeSqlText、upsert 幂等）；
// item_companies role 回写直接走 itemCompaniesUpsertSql（COALESCE 防清摆语义在 sqlgen 单测覆盖）。
import { escapeSqlText, itemCompaniesUpsertSql } from "../../../worker/sync/sqlgen";
import type { EnrichVerdict } from "./enrich";

const quote = (s: string): string => `'${escapeSqlText(s)}'`;

// enrich_cache upsert：result 为裁决数组 JSON 字符串；冲突更新 result/llm_model（created_at 保留首写）。
export function enrichCacheUpsertSql(itemId: string, resultJson: string, llmModel: string): string {
  return (
    "INSERT INTO enrich_cache (item_id, result, llm_model) " +
    `VALUES (${quote(itemId)}, ${quote(resultJson)}, ${quote(llmModel)}) ` +
    "ON CONFLICT(item_id) DO UPDATE SET result = excluded.result, llm_model = excluded.llm_model;"
  );
}

// 单条 item 的完整写库语句：enrich_cache upsert + item_companies role 回写（含 primary 在首位
// 的裁决数组）。两条语句各单行、`;` 结尾、以换行分隔（sqlgen 多语句同款纪律）；
// 供脚本逐 item 落盘执行，失败可按 item 定位重跑。
export function enrichApplySql(itemId: string, verdicts: EnrichVerdict[], llmModel: string): string {
  const cacheSql = enrichCacheUpsertSql(itemId, JSON.stringify(verdicts), llmModel);
  const roleSql = itemCompaniesUpsertSql(
    verdicts.map((v) => ({ itemId, companyId: v.companyId, role: v.role })),
  );
  return `${cacheSql}\n${roleSql}`;
}

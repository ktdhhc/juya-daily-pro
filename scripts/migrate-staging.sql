-- Spec10 Step 1.1 暂存基座迁移（本地 D1 一次性迁移）：
--   npm run db:migrate
--   （= wrangler d1 execute juya-daily --local --file scripts/migrate-staging.sql）
--
-- 幂等性说明（SQLite 的 ADD COLUMN 无 IF NOT EXISTS，重复执行报 duplicate column name: published）：
--   - 首次执行：全部语句生效，存量行 published 一律填 1（NOT NULL DEFAULT 1，spec10 契约「存量默认 published」）。
--   - 重复执行：两条 ALTER TABLE 报错属预期、可忽略（列已存在即迁移已完成）；
--     CREATE TABLE / CREATE INDEX 均带 IF NOT EXISTS，重复执行为 no-op。
--   - 重跑后用对账命令确认（列存在 + 行数不变，迁移只加列不加行）：
--       npx wrangler d1 execute juya-daily --local --command "PRAGMA table_info(items);"
--       npx wrangler d1 execute juya-daily --local --command "PRAGMA table_info(sources);"
--       npx wrangler d1 execute juya-daily --local --command "SELECT (SELECT COUNT(*) FROM items) AS items, (SELECT COUNT(*) FROM sources) AS sources, (SELECT COUNT(*) FROM companies) AS companies;"
--       （计数应与迁移前一致：items=1116 / sources=73 / companies=39）

ALTER TABLE items ADD COLUMN published INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sources ADD COLUMN published INTEGER NOT NULL DEFAULT 1;

-- ─── item_proposals（spec10 契约：解析段产出的归属建议，key=item_id）────────
CREATE TABLE IF NOT EXISTS item_proposals (
  item_id    TEXT PRIMARY KEY,
  owners     TEXT NOT NULL,                             -- JSON [{companyId, role}]
  llm_model  TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── company_candidates（spec10 契约：白名单外候选公司，人工 /review 处置后经 companies.yaml 入册，ADR-0001 仪式不变）────────
CREATE TABLE IF NOT EXISTS company_candidates (
  id             TEXT PRIMARY KEY,                      -- 建议 slug
  name           TEXT NOT NULL,
  aliases        TEXT NOT NULL DEFAULT '[]',            -- JSON 数组
  confidence     TEXT NOT NULL,
  reason         TEXT NOT NULL,
  source_item_id TEXT NOT NULL,                         -- 溯源：发现该候选的条目
  status         TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','registered','dismissed')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_company_candidates_status ON company_candidates(status);

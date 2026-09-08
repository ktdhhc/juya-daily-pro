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
--       npx wrangler d1 execute juya-daily --local --command "SELECT * FROM parse_state;"
--       （spec13 契约 A：应返回 idle 单行 id=1）
--
-- 原子性实测（wrangler 4.127）：d1 execute --file 整体是一个事务——任一语句报错则【全文件回滚】，
-- 并非「报错语句之外的语句继续生效」。因此：
--   - 全新库（含部署日生产 D1）：ALTER 成功，本文件一次执行全部生效（含 parse_state）。
--   - 已迁移过的库（ALTER 报错 duplicate column name）：整个文件回滚，文件内新增量表不会落库；
--     需以 --command 幂等引导（与文件内 parse_state 两语句逐字相同，可重复执行）：
--       npx wrangler d1 execute juya-daily --local --command "CREATE TABLE IF NOT EXISTS parse_state (id INTEGER PRIMARY KEY CHECK (id = 1), status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','running','done','failed')), started_at TEXT, finished_at TEXT, processed INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0, remaining INTEGER NOT NULL DEFAULT 0, errors TEXT NOT NULL DEFAULT '[]'); INSERT INTO parse_state (id) VALUES (1) ON CONFLICT(id) DO NOTHING;"
--     sync_runs（spec14 契约 A，同款幂等引导，可重复执行）：
--       npx wrangler d1 execute juya-daily --local --command "CREATE TABLE IF NOT EXISTS sync_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL, duration_ms INTEGER, window_dates TEXT NOT NULL, added TEXT NOT NULL DEFAULT '[]', updated TEXT NOT NULL DEFAULT '[]', unchanged TEXT NOT NULL DEFAULT '[]', failures TEXT NOT NULL DEFAULT '[]', staged_items INTEGER NOT NULL DEFAULT 0, ok INTEGER NOT NULL DEFAULT 1);"

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

-- ─── parse_state（spec13 契约 A：解析异步作业单行状态，同一时刻至多一轮解析）────────
-- 启动守卫（spec13 契约 B）：status='running' 且 started_at 距今 <10 分钟 → 409 parse_busy；
-- 超时陈旧（worker 中断遗留）允许覆盖重跑。errors 为 JSON 字符串数组字面量（默认空数组）。
CREATE TABLE IF NOT EXISTS parse_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','running','done','failed')),
  started_at TEXT,
  finished_at TEXT,
  processed INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  remaining INTEGER NOT NULL DEFAULT 0,
  errors TEXT NOT NULL DEFAULT '[]'
);

-- seed idle 单行：幂等（ON CONFLICT(id) DO NOTHING，重复迁移不覆盖作业真实状态）
INSERT INTO parse_state (id) VALUES (1) ON CONFLICT(id) DO NOTHING;

-- ─── sync_runs（spec14 契约 A：同步运行记录，每行 = 一次 POST /api/sync 的落地摘要）────────
-- JSON 文本列（window_dates/added/updated/unchanged/failures）由 worker/api/sync-runs.ts
-- 序列化与容错解析；ok 为 0/1（failures.length===0 → 1）。表语义为「运行完成的摘要」，
-- 无 seed 行——前端无记录时显「尚未同步」。
CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  duration_ms INTEGER,
  window_dates TEXT NOT NULL,
  added TEXT NOT NULL DEFAULT '[]',
  updated TEXT NOT NULL DEFAULT '[]',
  unchanged TEXT NOT NULL DEFAULT '[]',
  failures TEXT NOT NULL DEFAULT '[]',
  staged_items INTEGER NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 1
);

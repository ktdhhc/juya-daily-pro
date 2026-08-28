-- Juya AI Daily Plus · D1 schema
-- 见 docs/adr/0002 (item schema)、0005 (storage stack)、0007 (company page shape)、0008 (sync error handling)

-- ─── items ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS items (
  id              TEXT PRIMARY KEY,          -- YYYYMMDD-N
  date            TEXT NOT NULL,             -- YYYY-MM-DD
  tag             TEXT NOT NULL DEFAULT '',  -- #N；解析时缺失留空
  sequence_int    INTEGER NOT NULL DEFAULT 0, -- #N 整数（#3 -> 3），用于稳定 cursor 排序；缺则 0
  category        TEXT NOT NULL DEFAULT '',  -- 来自概览
  title           TEXT NOT NULL,
  primary_link    TEXT,                       -- 无主链接时 NULL
  summary         TEXT NOT NULL DEFAULT '',  -- 概览 '>' 后原文，缺则空串
  body_md         TEXT NOT NULL DEFAULT '',  -- 正文原文
  related_links   TEXT NOT NULL DEFAULT '[]', -- JSON 数组
  enrich_state    TEXT NOT NULL DEFAULT 'pending'
                  CHECK (enrich_state IN ('ok','missing_owner','pending')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_items_date      ON items(date DESC);
CREATE INDEX IF NOT EXISTS idx_items_category  ON items(category);
CREATE INDEX IF NOT EXISTS idx_items_enrich   ON items(enrich_state) WHERE enrich_state != 'ok';
-- /stream 列表 cursor 排序专用
CREATE INDEX IF NOT EXISTS idx_items_stream_cursor ON items(date DESC, sequence_int ASC);

-- ─── companies（Company Registry 镜像，源=data/companies.yaml）────────
CREATE TABLE IF NOT EXISTS companies (
  id        TEXT PRIMARY KEY,                -- slug
  name      TEXT NOT NULL,
  aliases   TEXT NOT NULL DEFAULT '[]',       -- JSON 数组（字面量或正则）
  color     TEXT NOT NULL,
  status    TEXT NOT NULL DEFAULT 'active'
             CHECK (status IN ('active','dormant','retired')),
  notes     TEXT NOT NULL DEFAULT ''
);

-- ─── item_companies ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS item_companies (
  item_id     TEXT NOT NULL,
  company_id  TEXT NOT NULL,
  role        TEXT  -- NULL=单家归属无 role；多家时 'primary'/'partner'/'subject'
                  CHECK (role IS NULL OR role IN ('primary','partner','subject')),
  PRIMARY KEY (item_id, company_id),         -- ADR-0008: DB 兜底防重复
  FOREIGN KEY (item_id)    REFERENCES items(id)    ON DELETE CASCADE,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ic_company ON item_companies(company_id);
CREATE INDEX IF NOT EXISTS idx_ic_item    ON item_companies(item_id);

-- ─── enrich_cache ───────────────────────────────────────────
-- LLM 多家归属的 role 判定结果缓存；key=item_id
CREATE TABLE IF NOT EXISTS enrich_cache (
  item_id     TEXT PRIMARY KEY,
  result      TEXT NOT NULL,                  -- JSON: [{companyId, role, reason}]
  llm_model   TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
);

-- ─── sync_log ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_log (
  date           TEXT PRIMARY KEY,           -- 一期一条；UPSERT
  attempted_at   TEXT NOT NULL DEFAULT (datetime('now')),
  status         TEXT NOT NULL
                  CHECK (status IN ('ok','fetch_failed','parse_failed','partial')),
  error_message  TEXT
);
# Spec 10 · 编辑工作流（同步-解析-入库三段制）

> 来源：2026-08-29 用户补充——手动数据入库拆成三步：**同步**（拉取新数据）→ **解析**（LLM 分析）→ **入库**（人工确认或编辑后上架）。上游：spec07（管理员与守卫）、spec09（LLM 纯函数与存量回填）、ADR-0001（白名单人工入册不变）、ADR-0015（三段制取舍记录）。
> 口径决策：用户原话「人工确认或者编辑后入库」→ **暂存制**——人工确认前新数据对访客不可见。本文可按顺序逐步执行。

## 目标

同步只把新数据拉进暂存区（零 LLM）；解析段在 Worker 内按需调 LLM，产出归属主次建议与候选公司；管理员在 /review 审核页逐条检查、编辑，一键确认入库；确认后内容对访客可见，徽章分主次，候选公司经人工搬入 companies.yaml 完成入册。

## 前置事实（开工前必须实测核验）

- [ ] workerd 环境 `fetch` + `AbortSignal.timeout` 可用（决定 chatJson 是否零改动共享；用 ping 实例 curl 或 wrangler dev 临时路由验证）
- [ ] 本地 D1 迁移：`ALTER TABLE ... ADD COLUMN` 经 `wrangler d1 execute --local` 可执行且幂等可控
- [ ] `MAX_LLM_PER_RUN`（wrangler vars，默认 20）、`LLM_API_BASE`/`LLM_MODEL`/`LLM_API_KEY`(secret) 已在 wrangler.jsonc
- [ ] 读 API 构造器集中在 `worker/api/queries.ts`（过滤加在构造器层，单测同步改）

## 契约（钉死）

### schema（本地迁移脚本，一次性）

- `items` / `sources` 增列 `published INTEGER NOT NULL DEFAULT 1`（存量 1116 条不受影响）
- 新表 `item_proposals`：`item_id TEXT PRIMARY KEY, owners TEXT NOT NULL /* JSON [{companyId, role}] */, llm_model TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))`
- 新表 `company_candidates`：`id TEXT PRIMARY KEY /* 建议 slug */, name TEXT NOT NULL, aliases TEXT NOT NULL DEFAULT '[]', confidence TEXT NOT NULL, reason TEXT NOT NULL, source_item_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','registered','dismissed')), created_at TEXT NOT NULL DEFAULT (datetime('now'))`

### 同步段（零 LLM）

- `itemsUpsertSql(items, opts?)` / `sourcesUpsertSql(date, md, opts?)`：`{ staged: true }` → INSERT 显式 `published=0`；**DO UPDATE SET 一律不含 published**（重同步不翻转、publish 后不被打回）
- `POST /api/sync`：走 staged 写入；响应增 `stagedDates: string[]`
- 读 API（daily/items/companies 及未来 stats）：一律 `published=1`
- `npm run backfill`：语义不变=全量 published（非 staged 默认值）

### 解析与审核 API（全部 requireAdmin，403 unauthorized）

- `POST /api/parse`：圈 published=0 且（多家命中无 proposal / missing_owner）条目 → LLM（enrich 判 primary + deriveRoles；missing_owner 走三分类）→ 写 `item_proposals` / `company_candidates`（company kind；product/ignore 不落库只计数）→ 返回 `{ processed, candidatesFound, remaining, skipped }`；MAX_LLM_PER_RUN 限流；重复调用幂等（已有 proposal 的条目跳过）
- `GET /api/review/pending`：`{ dates: [{ date, items: [{ id, title, summary, category, tag, owners: [{companyId,name,color,role|null}], proposal: { owners, llmModel } | null, candidate: { id,name,aliases,confidence,reason } | null }] }], candidates: [...pending 候选全量] }`（日期升序）
- `PATCH /api/review/item`：body `{ itemId, owners: [{ companyId, role }] }`（role ∈ primary/partner/subject，≤1 个 primary）→ 重写该条 item_companies（删后插）+ `enrich_state='ok'`；仅允许 published=0 的条目
- `POST /api/review/publish`：body `{ dates?: string[] }`（缺省=全部含暂存条目的日期）→ D1 batch 原子：published 0→1；有 proposal 的条目应用 owners（同 PATCH 语义）+ 写 enrich_cache；返回 `{ publishedDates, itemsPublished }`

### 前端

- Header 管理员态新增「审核」入口（待审期数 >0 时显示「审核·N」角标）→ `/review`
- `/review`（"use client"）：期卡片列表（条目 + 现归属徽章 + proposal 建议徽章对比）→ 条目编辑（改 primary / 调 role / 删归属——用既有文字链与 select 控件语言）→ 候选公司区（每条 id/name/aliases/reason + 状态操作：标记已入册 / 忽略 + 「复制 YAML」）→ 底部「确认入库」（按期勾选，默认全选）
- 访客直访 /review：AdminGate 原地解锁（同 spec08 模式）
- FRONTEND_DESIGN §4.9：审核工作流的待审/已决视觉语言（不发明新组件族）

## 执行步骤（线性）

### Step 1 — 暂存基座（零 LLM）
1.1 迁移脚本 `scripts/migrate-staging.sql` + `package.json` script `db:migrate`（wrangler d1 execute --local --file）；幂等（IF NOT EXISTS；列存在性用 PRAGMA 判断或 try-catch 重跑安全）
1.2 sqlgen staged 语义 + 单测（先红后绿）
1.3 同步路径（`worker/sync/index.ts`、`routes.ts` syncNow）写 staged；读 API 过滤（queries.ts 构造器 + 单测）；sync 响应加 stagedDates
1.4 回归：`npm run backfill`（默认 published）语义不变；既有数据计数不变

### Step 2 — 共享 LLM 层与解析/审核端点
2.1 `scripts/lib/llm.ts` 的 chatJson/runWithLimiter 提取至 `src/lib/llm/chat.ts`（零 node 依赖，前置事实核验通过后）；scripts/lib/llm.ts 改 re-export（scripts 侧不感知）；前置事实核验失败 → Worker 内自带等价实现并注明
2.2 `worker/api/parse.ts`：圈题纯函数（圈选逻辑独立可测）+ SQL 生成纯函数 + LLM 编排；写库经 binding batch
2.3 routes.ts 挂四个端点（parse/pending/item/publish）；curl 两态实测（--var 守卫实例）

### Step 3 — /review 审核页
3.1 页面与组件族（`src/app/review/page.tsx` + `src/components/review/`：StagedIssueList / ProposalEditor / CandidatePanel / PublishBar）
3.2 Header「审核·N」入口（管理员态挂载时查一次 pending 计数）
3.3 FRONTEND_DESIGN §4.9 补节

### Step 4 — 验证
- 全流程演练（本地）：sync → parse（--var 守卫实例 + 真实 LLM 数条）→ /review 编辑一条归属 → publish → 访客视角可见 + 徽章主次生效
- 访客不可见实测：publish 前 /api/daily/latest、/api/items、/api/companies 均无暂存内容
- 四门禁；build 静态页 44→45（+review）

## 验收清单

- [ ] 迁移幂等可重跑；backfill 回归不变（存量计数一致）
- [ ] 同步段零 LLM（/api/parse 不在 sync 调用链；grep 证据）
- [ ] parse 限流生效；候选带 source_item_id 溯源；重复调用幂等
- [ ] publish 原子（batch 回滚）；patch 后 ≤1 primary 约束生效
- [ ] 访客不可见暂存数据；确认后可见；审核编辑生效
- [ ] 四门禁绿；FRONTEND_DESIGN §4.9 已入

## 边界

- 不做草稿保存（编辑即提交 item 级 PATCH）；不做多管理员/权限分层；不做候选自动入册（人工经 companies.yaml 仪式）；不做 diff 历史。
- cron（部署日）行为=写暂存不自动 publish；解析节奏由管理员手动触发（按钮），自动解析部署日再议。
- 真实 LLM：Step 4 演练一次小规模（≤5 条），不整批跑（整批留给真实使用）。

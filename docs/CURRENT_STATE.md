# CURRENT_STATE

## 维护规则

- 防止过度膨胀规则：本文档一般保持在 100-200 行，最多不超过 250 行。写入时先判断是否值得记录、是否可以和已有内容合并、是否应删除旧内容。
- 应写什么：当前仍然有效且会直接影响开发判断的默认事实，如主链流程、关键字段、默认运行方式、关键入口文件、默认验证路径。
- 不应写什么：历史过程、讨论痕迹、未落地方案、一次性 workaround、局部实现细节、两周内很可能再次变化的临时约定。
- 更新触发条件：仅当主流程、默认行为、canonical 字段、关键入口文件或默认验证方式发生稳定变化时更新；普通小改、临时调试和未闭环改动不更新。
- 更新方式：本文件只做覆盖式更新，不追加历史；删除已失效事实，保留当前真相。
- 防漂移要求：每次更新都应尽量短，只保留"新 agent 不知道就容易做错"的内容；若一条信息不能稳定维持一段时间，宁可不写入本文件。

## 文档目的

- 本文件是当前仓库的精简版事实快照。
- 后续 agent 会话应优先阅读本文件。
- 对大多数编码任务，应先读本文件，再只读取直接相关的代码和测试。
- 其他方案文档和历史材料属于补充参考，不应作为默认首读材料。

## 项目一句话说明

把 daily.juya.uk 每日发布的 AI 资讯合集按"事件流 + 公司"两个维度重新整理，部署在 Cloudflare 上供多用户查阅，并为未来 RAG 预留语义索引入口。

## 当前阶段

A 类（方案定、代码未大规模落地）：11 枚 ADR 与 1 份 PRD 已固化，部分基础设施代码（schema.ts、matchCompanies.ts、companies.yaml、schema.sql、wrangler.jsonc、next.config rewrites）已落地，主要工作量待阶段 1 后开工。当前前端仍是单页 Next.js 静态导出（沿用旧 gh-pages 形态），Worker/后端/新视图尚未实现。

## 范围边界

- 做：MVP 内的日期阅读页 + 事件流视图 + 公司页 + cron 自动同步 + D1 + R2 + 纯函数 Vitest 覆盖。
- 暂不做：RAG / Vectorize / 话题聚类 / 告警 / 用户账号 / 多语言 / 公司行业子分类 / 自动迁移机制。

## 当前架构

```text
- 后端：Cloudflare Worker（待实现）——cron trigger（北京 08-11 半点）+ REST read API
- 前端：Next.js 16 (App Router, output export)，部署 Cloudflare Pages
- 持久化：D1（items / companies / item_companies / enrich_cache / sync_log 五张表）+ R2（原文归档）
- 任务执行方式：cron Worker 同步、本地 `npm run backfill` 一次性回填
- 关键外部依赖：daily.juya.uk（archive + markdown 源）；OpenAI 兼容协议 LLM API（多家归属 enrich）
```

## 主流程关键事实

1. **生产数据流**：daily.juya.uk `/archive/` → cron Worker 检测新期 → fetch `/markdown/<date>.md` → 写 R2 → `parseMarkdown` → `matchCompanies`（段一）→ 多家时 `enrichLLM`（段二，单分类挑 primary）→ upsert D1。
2. **前端取数**：四个路由 `/` `/stream` `/company` `/company/[id]` 全部走相对路径 `/api/*`（dev 由 next.config rewrites 代理到本地 `wrangler dev :8787`，生产由 Pages Functions 同域代理）。
3. **白名单闸门**：只有 `data/companies.yaml` 中登记的 Company 才会被标到 Item 上，retired 公司不参与匹配。yaml 是唯一真相源，Worker redeploy 后首次调用幂等 upsert D1 `companies` 表。
4. **幂等性**：cron 每次执行查 `max(items.date) + SYNC_LOOKBACK_DAYS`，仅拉新期；所有 upsert 走 `ON CONFLICT DO UPDATE`，可随时手动重跑。

## 不应轻易改动的约定

- `data/companies.yaml` 是 Company Registry 唯一真相源（ADR-0001），D1 `companies` 是只读镜像，手动同步会引入双写源。
- Item 主键 `YYYYMMDD-N`、保留 `body_md`、`summary` 不二次补全（ADR-0002）。
- Company 归属白名单闸门、多家才用 LLM（ADR-0001 + ADR-0003）。
- LLM 任务只判 primary、partner/subject 启发式补（ADR-0009）。
- 同期同主话题补丁不折叠、跨期同主题也不合并（CONTEXT.md Item 定义）。

## 分支流程

- **首次回填**：本地 `npm run backfill`（Phase 1 才实现），用 wrangler 客户端直连远程 D1/R2，跑一遍全量历史 archive，不受 Worker 30s CPU 限制。
- **Company Registry 候选**：LLM 提议写入 `data/companies-pending.yaml`（不进 D1），人工 review 后搬进 `companies.yaml` 并 git push 触发 Worker redeploy。
- **同日补丁**：不折叠（CONTEXT.md / PRD-User Story #2），每个 `#N` 独立成 Item 入库。

## 当前 UI 结构

- 顶部 Header（sticky）：品牌名、日历按钮、复制链接、外部链接、ThemeToggle、Reading Progress。
- 当前唯一路由 `/`：当前期阅读页（cover + videoLinks + 概览分类 + react-markdown 正文 + TOC + 前后期导航 + Back-toTop）。
- 6 套主题（data-theme 属性 + CSS 变量，详见 `src/app/globals.css`）。
- 待 RF 拆掉：未完成的 `/stream`、`/company`、`/company/[id]` 路由与对应组件。

## 当前前端整体现状

- 单页静态导出壳 + 浏览器内 fetch daily.juya.uk/markdown（旧 gh-pages 体感，**将被改为 fetch /api/daily/[date]**）。
- `src/lib/github.ts` 仍是旧 fetch 逻辑（命名也旧），待阶段 0 改名 `juya.ts` 并下沉到 Worker；前端只剩渲染层。
- 存在历史债：`README.md` 数据源描述已统一为新 juya-daily-plus 介绍（阶段 0 已清）、`globals.css` 残留 botanical 主题死变量与 `.site-badge` 死代码（阶段 0 待清）。

## 关键文件地图

```text
src/lib/schema.ts             # Item / Owner / Company / CompanyCandidate 类型契约（ADR-0002 落地）
src/lib/matchCompanies.ts     # 段一确定性匹配器（ADR-0003 落地，已含正则+字面量 alias）
data/companies.yaml           # Company Registry 真相源（30 家种子）
worker/sync/schema.sql        # D1 五张表完整定义
wrangler.jsonc                # cron `0,30 0,1,2 * * *`、vars、D1/R2 绑定、secret 引用
next.config.ts                # output export + dev rewrites /api/* → :8787
.dev.vars                     # 本地 env 模板（已 .gitignore）
docs/prd/PRD.md               # 30 条 user stories + 实现决策汇总
docs/adr/0001-0011.md         # 11 枚 ADR（按需查，独立文件而非合订本）
```

## 重要运行事实

- cron 频率：UTC 00:00 / 00:30 / 01:00 / 01:30 / 02:00 / 02:30 共 6 次/天（北京 08:00-11:00 半点）。
- LLM 仅在多条 Item 命中 ≥2 家白名单公司时调用；prompt 任务收窄到"挑一个 primary"，受 `MAX_LLM_PER_RUN=20` 限流。
- Enrich 结果写 D1 `enrich_cache` 表（按 `item_id` PK），可手工覆盖。
- 解析半成功的 Item（缺摘要 / 缺 #N / 缺相关链接）仍入库，`enrich_state=pending`，前端做回退渲染。
- 所有 read API 端点在 Worker 内走 `caches.default` 60s 缓存。
- 错误响应统一 `{ error: { code, message } }`。
- 环境变量名为 `LLM_API_BASE` / `LLM_API_KEY`，不是 `OPENAI_*`。

## 工作目录规则

```text
前端命令在仓库根目录（npm run dev / npm run build）。
Worker 命令在仓库根目录用 wrangler（wrangler dev / wrangler deploy）。
一次性回填 `npm run backfill` 在根目录执行（本地 Node 脚本，连远程）。
不切目录。
```

## 默认验证方式

```text
- 纯函数（parseMarkdown / matchCompanies / 启发式 role 补全）：`npm test <pattern>` 跑针对性 Vitest。
  测试位置自阶段 1 起于 worker/ 同目录（parse.test.ts 等），纯函数 suite。
- Worker 行为：本地 `wrangler dev --remote` 手动验证 /api/* 响应；真实 LLM 调用、远程 D1 roundtrip 视为高成本，不作默认验证。
- 前端：`npm run dev` 看视觉；`npm run build` 必须产出 out/ 静态产物验证导出无误。
- 类型与 lint：阶段 0 加 typecheck script 与最简 eslint 配置（详见 docs/plans/mvp-build-phases.md 阶段 0）。
```

## 当前可维护性热点

- `src/lib/github.ts` 命名与实现都需要重命名为 `juya.ts`；fetch 逻辑要移到 Worker；前端将仅消费 `/api/*`。
- `globals.css:129` botanical 主题死变量、`globals.css:118` `.site-badge` 全无组件使用——阶段 0 清债。
- 类型契约与 schema 已建（`src/lib/schema.ts`），但 Worker 与前端尚未消费——落地时务必匹配这套形状。
- `wrangler.jsonc` 里 `database_id` 当前是占位符 `REPLACE_WITH_REAL_D1_ID`，部署前需替换。

## 后续会话约束

- 不要假设历史文档始终完全同步，应优先相信代码和本文件。
- 常规编码任务不要把历史日志或 ADR 当作必读材料；只在需要"为什么这样设计"时按编号查 ADR。
- 除非任务明确要求，不要擅自引入新的状态库、payload 结构或核心术语；术语以 `CONTEXT.md` 为准。
- 改 `companies.yaml` 不手动同步 D1（ADR-0001 v2 D 变体）。
- 改 `wrangler.jsonc.triggers.crons` 需 redeploy 才能生效（Cloudflare 平台限制）。
- 任何破坏 Item schema（ADR-0002）、白名单闸门（ADR-0001）、两段归属（ADR-0003）的改动，先回头读对应 ADR 再决策。
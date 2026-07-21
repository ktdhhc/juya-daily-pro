# PRD · Juya AI Daily Plus

把 [daily.juya.uk](https://daily.juya.uk) 每日发布的 AI 资讯合集，按"时间线"与"公司"两个维度重新整理，部署在 Cloudflare 上供多用户查阅，并为未来引入 AI 问答 / RAG 预留语义索引入口。

> 本 PRD 是已敲定决策的整合视图。所有架构权衡见 `docs/adr/0001-0011`；术语见 `CONTEXT.md`。

## Problem Statement

daily.juya.uk 每天早晨发布一期 AI 资讯合集（Daily Issue），把当天所有 AI 事件打包成一篇 Markdown。这种"按天聚合"的形态让以下两类查阅体验很差：

1. "某家公司最近在做什么" —— 想知道 Anthropic 这两个月有什么动作，得翻几十期 Daily Issue，每期扫一遍标题找 Claude / Anthropic / Fable。
2. "过去两个月这条主线怎么演化" —— 想知道 Kimi 上个月到这个月发生了什么，得线性扫每期找出 Kimi 标签下的多条并自己脑补时间线的关联。

而且报社本身由 AI 辅助创作，作者明示可能存在幻觉与错误，单期阅读时分散在各条 `#N` 编号事件里的关联信息（同日补丁、跨日报道）需要读者自己拼。

## Solution

把 Daily Issue 拆解成可独立查询的 Item 原子单位，存入 Cloudflare D1，并按"时间线"和"公司"两个新视图对外提供查询：

- **Item** 是数据原子单位，每个 `#N` 对应一条，含标题、主链接、摘要、正文、相关链接、归属 Category 与 Company。
- **时间线视图 `/timeline`** 按天分组的 Item 卡片流，左侧 facet 可按公司、分类、日期范围筛选，支持全文检索。
- **公司视图 `/company` 与 `/company/[id]`** 公司索引页 + 单公司档案页（档案头含身份、活跃度、性质画像、行业关系、时间跨度五块）。
- **每日自动同步 cron Worker** 在北京 08-11 半点抓取 juya-daily 新期，写入 R2 归档 + 解析 + 白名单匹配 + 必要时 LLM enrich + upsert D1。
- **首页 `/` 仍为日报阅读页**，现已切到 `/api/daily/[date]` 路径统一数据口径（最坏滞后 30 分钟）。
- **未来 RAG** 走 D1 + Vectorize index，在已有 Item 结构上叠加 embedding 列与语义检索接口。

## User Stories

1. 作为 AI 资讯重度读者，我想打开站点就能按时间倒序看到所有 Item 的卡片流，这样我能用类似 Twitter 的下划体验浏览所有事件。
2. 作为 AI 资讯重度读者，我想在时间线左侧勾选某家公司 + 某个分类 + 某个日期范围，这样我能快速看到"Anthropic 本月发布的所有模型"这种切面。
3. 作为对某家公司感兴趣的用户，我想打开 `/company/openai` 一眼看到 OpenAI 的活跃度、性质画像、行业关系、时间跨度，这样我能用一次点击留下"这家公司在做什么"的整体印象。
4. 作为对某家公司感兴趣的用户，我想在公司页底部按时间倒序看到所有涉及该公司的 Item，这样我能快速捋清它的演化。
5. 作为想分享一个公司画像的人，我想把 `/company/anthropic` 的 URL 发给朋友，这样对方无需登录即可看到完整档案。
6. 作为想深读某条事件的用户，我想点击时间线卡片上的"看原期"按钮跳回首页对应日期的 anchor，这样我能看到该事件在原日报语境下的完整呈现。
7. 作为想深读某条事件的用户，我想点击时间线卡片上的公司徽章跳到对应公司页，这样我能快速切换到"按公司看"的视角。
8. 作为想跳转一手源的用户，我想点击时间线卡片标题旁的 ↗ 直接打开官方源（微信公告 / X 帖 / GitHub 仓库），这样我能最快读到一手信息。
9. 作为想了解多家公司合作关系的用户，我想看到同一条 Item 上多家公司的彩色徽章并排，主公司徽章略大、合作方次之，这样我能一眼识别主次关系。
10. 作为维护白名单的仓库 owner，我想编辑 `data/companies.yaml` 后 `git push`，白名单自动在下次 Worker 调用时同步到 D1，这样我不需要额外运维步骤。
11. 作为维护白名单的仓库 owner，我想 LLM 提议的新公司候选落到 `data/companies-pending.yaml` 而不是直接进入白名单，这样我能 review 后再决定是否入册。
12. 作为仓库 owner，我想看到 `sync_log` 表里哪些期 fetch 失败或解析异常，这样我能人工 review juya-daily 的结构异常。
13. 作为仓库 owner，我想首次回填历史数据时跑 `npm run backfill` 在本地连远程 D1/R2，这样我能一次性补齐几十天的历史 archive 而不受 Worker 30s CPU 限制。
14. 作为多用户场景的部署者，我想把前端部署到 Cloudflare Pages、后端部署到独立 Worker，两个部署单元解耦，这样将来加缓存层/安全层不动另一端。
15. 作为多用户场景的部署者，我想所有可调运维参数（cron 频率除外）走环境变量，这样我可以不 redeploy 代码就切换 LLM 提供方、关闭 enrich、调整 lookback 天数。
16. 作为 NYT 早报式日常读者，我想首页 `/` 仍然是当前期阅读页面、保留 6 套主题切换、原 `?date=` 链接继续可用，这样我不破坏已有阅读习惯。
17. 作为想搜索的用户，我想在顶部搜索框输入"Kimi 上市"高亮看到所有标题/摘要/正文命中项，这样我能跨期定位某条事件。
18. 作为开发阶段的工程师，我想要 `parseMarkdown` 与 `matchCompanies` 这些纯函数有 Vitest 单测覆盖，避免日报结构变化时静默退化。
19. 作为对某条事件感兴趣的用户，我想点击 Item 卡片底部"3 个相关链接"看到全部相关补充材料列表，这样我不丢任何辅助信息。
20. 作为对数据真实性敏感的用户，我想看到 LLM enrich 的角色判定结果保存在 `enrich_cache` 表里并可手工覆盖，这样我能纠正 LLM 的错误而不污染原始 Item 数据。
21. 作为对缺失归属友好的用户，我想"白名单未命中"的 Item 仍然正常显示在时间线与日期阅读页（只是公司页看不到），这样白名单闸门不丢弃任何条目。
22. 作为关注事件异常的用户，我想在某期 Item 解析半成功（缺摘要、缺 #N、缺相关链接）时该 Item 仍入库且 `enrich_state=pending` 标记，前端 graceful 渲染（空摘要回退首句+占位符），这样单期污染不阻塞整轮 cron。
23. 作为关注公司画像的用户，我想在档案头看到"与 Anthropic 共同出现 4 次"的关联公司列表可点击跳转，这样我能横向追踪行业关系网。
24. 作为关注数据覆盖的用户，我想看到公司档案头里的"最早事件 / 最近事件"日期，这样我知道这家公司在数据集里的覆盖范围是否够长。
25. 作为关注公司性质画像的用户，我想看到公司档案头里"模型发布 12 / 行业动态 5 / ..."的分类分布条形，这样我一眼看出这家公司平常都在做什么类型的新闻。
26. 作为想离线调前的开发者，我想要 Next dev + wrangler dev 双本地进程、前端通过 rewrites 代理 `/api/*` 到 Worker，这样我无需配置 CORS。
27. 作为想离线调前的开发者，我想 `.dev.vars` 提供本地 env 模板、`.gitignore` 已隔离，这样我不会误提交密钥。
28. 作为想部署的开发者，我想 `wrangler.jsonc` 已声明 cron + vars + D1/R2 绑定 + secret 引用，这样 deploy 一条命令完成。
29. 作为关注 cron 频率的运维者，我想 cron 在北京时间 08:00-11:00 半点触发（共 6 次/天），对齐 juya-daily 早晨发布窗口，这样 Worker 占用低且新期落地延迟最坏 ≤ 30 分钟。
30. 作为关注一致性的用户，我想首页与时间线/公司页走同一条 Worker read API，避免"今天的事件在公司页和时间线缺、首页能看到"的口径分裂。

## Implementation Decisions

### 术语对齐

全部采用 `CONTEXT.md` 中的术语：**Daily Issue / Item / Category / Primary Link / Related Links / Company / Company Registry / Role**。`_Avoid_` 标签下禁止使用的同义词：早报、entry、article、section、vendor、white list、entity table 等。

### 储存栈

- `R2` 存档原文：`daily/<YYYY-MM-DD>.md`，~30KB/天，审计回放与未来 schema 变更时全量重解析的源。
- `D1` 主存四张表：
  - `items`：Item 字段（详见 ADR-0002），唯一 PK `YYYYMMDD-N`，`date DESC` / `category` / `enrich_state` 索引
  - `companies`：Company Registry 镜像（由 `companies.yaml` 编译进 Worker 后首次调用幂等 upsert）
  - `item_companies`：多对多关联，PK `(item_id, company_id)` 防重入兜底，`role` 字段允许 NULL（单家归属时缺省）
  - `enrich_cache`：LLM 多家归属判定的 primary + reason 缓存，按 `item_id` PK
  - `sync_log`：每期同步日志，`date` PK + UPSERT
- `Vectorize` 留二期（RAG 页落地时引入）：Item 的 `summary + bodyMd` 分块 → embedding → index；检索后按 `item_id` join 回 D1 补展示字段。

### Company Registry 维护流程

- 真相源：`data/companies.yaml`（git 历史即审计日志）
- LLM 候选：`data/companies-pending.yaml`，不入 D1，需人工搬进 `companies.yaml` 后才有效
- sync 机制：Worker 构建阶段把 yaml 编进打包产物；Worker 在 `scheduled` / `fetch` 入口幂等 upsert D1 `companies` 表（按 `id` 唯一约束）
- 字段：`id / name / aliases[] / color / status(active|dormant|retired) / notes`
- 入册门槛：偏严，宁可漏掉边缘候选由后续审核补，不放宽到"被报道一次就入册"

### Item schema

```ts
{
  id: "YYYYMMDD-N"      // 例：20260720-3
  date: "YYYY-MM-DD"
  tag: "#N"              // 解析缺失留空
  category: string       // 来自概览
  title: string
  primaryLink?: string   // 无主链接时缺省
  summary: string         // 概览 '>' 后原文，绝不二次补全
  bodyMd: string         // 正文 markdown 原文
  relatedLinks: string[]
  owners: [{company, role?}]  // 0..N；单家时 role 缺省，多家时每家有 role
  enrichState: "ok"|"missing_owner"|"pending"
}
```

### Company 归属两段解析

- 段一（确定性，已实现 `matchCompanies.ts`）：白名单 `aliases[]` 在 Item 的 `title + bodyMd` 上做字面量 + 正则混合匹配，同公司多别名命中内部去重，得到候选集 S；retired 公司不参与匹配。`|S| ≤ 1` 时直接出 owners；`|S| = ∅` 时该 Item `enrich_state=missing_owner`（仍合法入库）。
- 段二（LLM 辅助，仅 `|S| ≥ 2`）：LLM 任务收窄到"挑一个 primary" + 给一句理由（不是 N 分类、不输出 confidence）；partner / subject 用确定性启发式补（title 中"与/和"连接 → partner，仅 body 提及 → subject）。结果写 `enrich_cache`，可手工覆盖。

### REST API 形状

- `GET /api/daily/latest` → 最新一期的 markdown 原文 + parsedOverview
- `GET /api/daily/:date` → 指定日期 markdown + parsedOverview（首页用，含 body_md）
- `GET /api/items?company=&category=&from=&to=&limit=&cursor=` → Item 列表 cursor 分页（**列表不返回 body_md**）
- `GET /api/companies` → 公司列表含各家事件统计
- `GET /api/companies/:id` → 单公司档案头五块（基础 + 统计 + 分类分布 + 关联公司 + 时间跨度）+ 该公司 Item 列表
- 所有 GET 端点在 Worker 内走 `caches.default` 60s 缓存
- 错误格式统一 `{ error: { code, message } }`

### cron 与同步

- cron 触发频率：wrangler.jsonc `["0,30 0,1,2 * * *"]`（UTC 00-03 半点 = 北京 08-11 半点，共 6 次/天）
- 每次执行：查 D1 `max(date)` + `SYNC_LOOKBACK_DAYS`（防 archive 单源漏期） → 抓 archive → 拉新期 markdown → 写 R2 → parseMarkdown → 白名单匹配 → 必要时 LLM enrich（受 `MAX_LLM_PER_RUN` 限流防失控） → upsert D1
- 幂等：`items` 和 `item_companies` 全字段 `ON CONFLICT DO UPDATE`，可随时手动触发
- 单期失败独立 try-catch、写 `sync_log`、继续下一期；D1 残缺 Item 走 `enrich_state=pending`

### Runtime 参数

通过 Cloudflare Worker `vars`（明文，redeploy 改）与 `secrets`（密文，`wrangler secret put` 改）注入：

| 参数 | 类型 | 默认值 |
|---|---|---|
| `ARCHIVE_URL` | var | `https://daily.juya.uk/archive/` |
| `MD_BASE` | var | `https://daily.juya.uk/markdown` |
| `SYNC_LOOKBACK_DAYS` | var | `3` |
| `LLM_ENABLED` | var | `true` |
| `LLM_API_BASE` | var | `https://api.openai.com/v1` |
| `LLM_MODEL` | var | `gpt-4o-mini` |
| `ENRICH_CACHE_ENABLED` | var | `true` |
| `MAX_LLM_PER_RUN` | var | `20` |
| `R2_BUCKET` | var | `juya-daily-archive` |
| `LLM_API_KEY` | secret | — |

cron 表达式本身在 `wrangler.jsonc.triggers.crons`，改频率需 redeploy（Cloudflare 平台限制）。

### 路由结构

- `/` 当前期阅读页（现状不变，`?date=` 同步）
- `/timeline` 全局时间线 + facet 筛选
- `/company` 公司索引页
- `/company/[id]` 单公司页
- Header 在四页共用、新增 Nav 三联（`日期 | 时间线 | 公司`）+ 右侧 ThemeToggle

### 视图渲染细节

- 时间线按天分组：日期行 + 当天 Item 卡片堆叠
- 时间线卡片字段：日期 / 公司徽章（多家并排主公司略大）/ 分类小标 / 标题 / 主链接 ↗ / 摘要 / 相关链接数量 / 公司数 +N 提示 / Role 提示 / 跳转公司页 / 跳转日期阅读页"看原期"
- 公司页档案头五块：基础（name+color 徽章+notes+aliases）、统计（total / last30d / lastEventDate）、分类分布 `{category: count}`、关联公司 `[{companyId, name, color, count}]` 至多 8 家按次数倒序、时间跨度（earliestDate / latestDate）
- 公司页下方：该公司 Item 按时间倒序展示
- 空态：骨架 + 空筛选结果提示 + 404 跳回索引页 + fetch 失败重试按钮（MVP B 套简化、无插画）

### 本地开发拓扑

- 前端：`npm run dev` 跑 `:3000`
- 后端：`wrangler dev` 跑 `:8787`，`--remote` 连真实 D1/R2
- next.config.ts rewrites 把 `/api/*` 代理到 `:8787`，前端用相对路径 fetch
- 双终端但每个都是标准工作流

### 部署拓扑

- 前端 → Cloudflare Pages（`out/` 静态导出）
- 后端 → 独立 Worker（cron sync + read API）
- 生产 `/api/*` 走 Pages Functions 代理或 Worker custom domain 共享同域

## Testing Decisions

### 测试哲学

只测外部行为，不测实现细节。MVP 阶段只测下游入口纯函数，不测 Worker fetch 入口 / D1 SQL / 前端组件 / E2E。LLM 真实调用不测（成本高且不稳定），依赖 `enrich_cache` 表里人工 review。

### 测试覆盖范围

| 模块 | 测试类型 | 覆盖点 |
|---|---|---|
| `parseMarkdown` | Vitest 单测 + 快照 | 抽样真实日报 md 做快照、边界 case（无主链接、缺 #N、缺 `>` 摘要、缺相关链接块）断言 |
| `matchCompanies` | Vitest 单测 | 白名单 alias 命中、正则/字面量混合、同公司多别名去重、retired 公司不命中 |
| `enrichLLM` prompt 组装 | Vitest 单测 | prompt 拼接（不调真实 LLM） |
| 启发式 role 补全 | Vitest 单测 | title "与/和"连接 → partner、仅 body 提及 → subject |

### 测试为何选这个 seam

最高可用 seam 是纯函数层：parse 与 match 都是手写正则、易错且下游全靠它们。snapshot 测试在日报结构异常变化时让 CI 立即报警。Worker 入口测易脆、D1 SQL 测需起 Wrangler Miniflare（MVP 阶段价值低于复杂度）、前端组件靠视觉 review 与读 API 真实响应验证。

### Prior art

仓库当前无测试（已有 11 枚 ADR 全部为设计决策、无单测 fixture）。本 PRD 是首次引入测试。

## Out of Scope

- 跨日同主题事件的话题聚类与时间线折叠（同日补丁已明确不折叠、跨日 LLM 聚合留二期）
- 公司简介 LLM 自动生成
- 全文语义检索（Vectorize / RAG 问答页）
- 用户账号、收藏、订阅、个性化订阅推送
- 多语言界面（产品定位中文读者）
- 告警系统（Worker Email Routing / Discord webhook）
- 自动迁移机制（`schemaVersion` 字段；schema 变更走重新跑回填）
- 公司行业子分类（lab/tool/infra 等 facet）
- 移动端独立 app / PWA
- 数据可视化大屏（除分类分布条形外）

## Further Notes

- 本 PRD 由一次深度 design tree 系列访谈产出，所有 11 枚 ADR（`docs/adr/0001-0011`）是该 PRD 的可追溯附录，PRD 与 ADR 冲突时以 ADR 为准（ADR 是更细的权衡记录）。
- 已建文件：`CONTEXT.md` / `data/companies.yaml`（31 家种子） / `data/companies-registry-todo.md` / `src/lib/schema.ts` / `src/lib/matchCompanies.ts` / `worker/sync/schema.sql` / `wrangler.jsonc` / `.dev.vars` / 修正后的 `next.config.ts`。已删 `.github/workflows/deploy.yml`（gh-pages 痕迹）。
- 历史 git 债务（阶段 0 清债）：`README.md` 仍指向旧 GitHub 源、`src/app/globals.css:129` 残留 `--botanical-gold*` 未定义变量与 `.site-badge` 死代码、无 eslint/typecheck 配置、CI 仅跑 build。这些清债任务在工作开始时一并处理。
- 路线阶段化顺序（值此 PRD 落地后的执行序：见各 ADR 末尾的 Consequences 段）：
  - 阶段 0：清债 + Cloudflare Pages 切换
  - 阶段 1：解析器重构（`parseMarkdown` 升级到完整 Item） + schema 类型对齐 + R2 历史回填脚本
  - 阶段 2：D1 建表 + 一次性回填
  - 阶段 3：白名单 + 候选匹配 + LLM enrich 段
  - 阶段 4：read API Worker + 前端新增三视图
  - 阶段 5：cron Worker 自动同步
- 二期 RAG 落地时需新写 ADR：Vectorize index 设计、embedding 模型选型（建议走 Workers AI embedding）、检索后回 join D1 的契约、缓存策略。
- 二期 Workflows 不在本 PRD 范围；若未来同步逻辑需要长任务（如全量重解析），再讨论是否引入 Cloudflare Workflows。
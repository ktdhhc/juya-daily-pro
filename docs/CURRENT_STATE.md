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

把 daily.juya.uk 每日发布的 AI 资讯合集按"事件流 + 公司"两个维度重新整理；v1 本地优先（D1 单存储 + 手动同步，零 Cloudflare 登录），部署与多用户产品化后移（ADR-0013）。

## 当前阶段

阶段 0-4 已完成（2026-08-29）：read API 5 端点（`worker/api/`，wrangler dev :8787）+ 三视图（`/stream`、`/company`、`/company/[id]`，FRONTEND_DESIGN「合订本×轻科技」落地）+ 报头/合订本/骨架改造；vitest 104 测试；本地 D1：items 1105（ok 863 / missing_owner 242）、item_companies 1222、companies 30。本地双进程（`npm run dev` :3000 + `wrangler dev` :8787）全链路可用，浏览器截图验证通过。下一步为阶段 5（`npm run sync` 手动增量同步），之后即部署日门槛。

## 范围边界

- 做（v1）：三新视图（/stream、/company、/company/[id]）+ 本地 D1 六表（含 sources 原文表）+ read API + `npm run sync` 手动同步 + 确定性白名单匹配 + 纯函数 Vitest 覆盖。
- 暂不做（v1 裁剪，见 ADR-0013/0014）：RAG / Vectorize / 语义检索 / LLM enrich 关键路径 / R2 / cron 自动同步 / Cloudflare Pages 部署 / 首页迁移 read API；以及话题聚类 / 告警 / 用户账号 / 多语言 / 公司行业子分类 / 自动迁移机制。

## 当前架构

```text
- 后端：Cloudflare Worker（待实现）——REST read API + 共享 sync 模块（本地 npm run sync 手动触发；scheduled 入口预留，部署日启用 cron）
- 前端：Next.js 16 (App Router, output export)；v1 本地开发 + wrangler dev 本地模拟，不部署
- 持久化：D1 六张表（items / sources / companies / item_companies / enrich_cache / sync_log）——唯一存储引擎，无 R2
- 任务执行方式：本地 `npm run sync` 增量同步、`npm run backfill` 一次性回填（均连 wrangler 本地模拟 D1）
- 关键外部依赖：daily.juya.uk（archive + markdown 源）；LLM API 仅部署日 enrich 回填时用
```

## 主流程关键事实

1. **数据流（v1）**：`npm run sync` 查 `max(items.date)` + `SYNC_LOOKBACK_DAYS` → 抓 daily.juya.uk archive → 拉新期 markdown → 写 D1 `sources` → `parseIssue` → `matchCompanies`（确定性单段，ADR-0014）→ upsert D1。`npm run backfill` 为全量历史回填。均幂等（`ON CONFLICT DO UPDATE`）。**当前状态：backfill 已跑通（sources 72 / items 1105 / companies 30），sync 待阶段 5。**
2. **前端取数**：三新视图 `/stream` `/company` `/company/[id]` 走相对路径 `/api/*`（dev 由 next.config rewrites 代理到本地 `wrangler dev :8787`）；**首页 `/` 维持直连 daily.juya.uk 不变**（部署日才迁移统一口径，ADR-0013）。fetch 统一走 `src/lib/api.ts` 的 apiFetch（错误集中处理为 ApiError）。
3. **白名单闸门**：只有 `data/companies.yaml` 中登记的 Company 才会被标到 Item 上，retired 公司不参与匹配。yaml 是唯一真相源，sync 时幂等 upsert D1 `companies` 表。
4. **归属规则（v1）**：单段确定性匹配——0 命中 `missing_owner`（仍入库）、1 家单归属、≥2 家并列归属且 **role 全部 NULL**（徽章并列不分主次）；LLM enrich（role 回填）为部署日后离线任务，`enrich_cache` 表保留但 v1 不写入。

## 不应轻易改动的约定

- `data/companies.yaml` 是 Company Registry 唯一真相源（ADR-0001），D1 `companies` 是只读镜像，手动同步会引入双写源。
- Item 主键 `YYYYMMDD-N`、保留 `body_md`、`summary` 不二次补全（ADR-0002）。
- v1 归属只跑确定性段一、多家并列 role=NULL；LLM enrich 后置为部署日回填、任务设计见 ADR-0009（ADR-0014）。
- RAG / Vectorize 已裁剪；检索需求由 Phase 2 全文检索承接（ADR-0014）。
- 同期同主话题补丁不折叠、跨期同主题也不合并（CONTEXT.md Item 定义）。
- 部署动作（cron / Pages / R2 / 首页迁移）集中在阶段 6 部署日，不在各阶段顺手做（ADR-0013）。

## 分支流程

- **首次回填**：本地 `npm run backfill`（阶段 2 实现），连 wrangler 本地模拟 D1，零 Cloudflare 登录。
- **增量同步**：`npm run sync`（阶段 5 实现）；部署日后由 cron Worker 自动执行。
- **Company Registry 候选**：LLM 提议写入 `data/companies-pending.yaml`（不进 D1）——流程随部署日 enrich 回填启用；日常入册直接编辑 `companies.yaml` 并 git 提交。
- **同日补丁**：不折叠（CONTEXT.md / PRD-User Story #2），每个 `#N` 独立成 Item 入库。

## 当前 UI 结构

- 报头（全站共用）：品牌方印「橘」+ Nav 三联（日报/事件流/公司，激活 3px 墨线）+ 刊号/主题切换；阅读页专属控件（日历/复制/外链/进度条）仅 `/` 显示。
- `/` 阅读页：直连 daily.juya.uk（部署日迁移），galley 骨架 + 合订本日历（竖排月份+裸数字网格+当前压印）。
- `/stream`：facet 栏（公司/分类/时间，竖排标签+墨点）+ 按天分组条目流（页边 #N 编号列+钤印脚注行），facet↔URL 双向同步，before_date 滚动翻页。
- `/company`：印章卡片墙（total 倒序）+ 客户端搜索。
- `/company/[id]`：档案头五块（大方印/统计/分类墨条分布/关联钤印/时间跨度）+ 差异渲染条目列表；generateStaticParams 由 REGISTRY 枚举 30 家。
- 6 主题不变（cyber 已去辉光）；设计契约见 `docs/FRONTEND_DESIGN.md`。
- 设计原型：`demo/index.html`（纯静态单文件）。

## 当前前端整体现状

- 单页静态导出壳 + 浏览器内 fetch daily.juya.uk/markdown（v1 首页保持此形态，部署日才切 `/api/daily/[date]`）。
- `src/lib/github.ts` 仍是旧 fetch 逻辑（命名也旧），阶段 0 改名 `juya.ts`；升级版 `parseMarkdown` 将下沉到 `worker/sync/parse.ts`（阶段 1），前端只保留渲染层。

## 关键文件地图

```text
src/lib/schema.ts             # Item / Owner / Company / CompanyCandidate 类型契约（ADR-0002 落地，含 sequenceInt）
src/lib/matchCompanies.ts     # 段一确定性匹配器（ADR-0003 段一落地，正则+字面量 alias）
src/lib/juya.ts               # 日报数据源 fetch + parseMarkdown 概览解析（原 github.ts；部署日 fetch 下沉 Worker）
worker/sync/parse.ts          # parseIssue：一期 md → {date, Item[]} 纯函数（规则真相源 docs/spec/spec01 2.2）
worker/sync/parse.test.ts     # 16 测试：fixture 快照 ×4 + 边界 case ×12；快照 diff 即日报结构漂移报警
worker/sync/fixtures/         # 真实日报语料（2026-08-27 / 2026-08-25）+ archive 页样本（archive-sample.html）
worker/sync/archive.ts        # parseArchiveDates：archive HTML → 期日期列表（去重倒序）
worker/sync/sqlgen.ts         # D1 upsert SQL 生成纯函数（escape / sources / items / companies）
scripts/gen-registry.ts       # data/companies.yaml → worker/registry.generated.ts（含校验；npm run gen:registry）
worker/registry.generated.ts  # 生成物：REGISTRY: Company[]（30 家）——勿手改，改 yaml 后重跑 gen:registry
worker/sync/match.ts          # matchAll 纯编排：items × registry → ownerRows / okIds / missingIds
scripts/match-all.ts          # 全量匹配回写（npm run match:all，幂等）；scripts/lib/wrangler-cli.ts 为共享 wrangler 执行器
scripts/backfill.ts           # 全量回填胶水：archive → parse → sqlgen → wrangler d1 execute --local（npm run backfill，幂等）
eslint.config.mjs             # lint 门禁（next 预设；set-state-in-effect 降级 warn 的理由见文件内注释）
.github/workflows/ci.yml      # CI：npm ci + typecheck + lint + build（无部署 step）
data/companies.yaml           # Company Registry 真相源（31 家种子）
worker/sync/schema.sql        # D1 表定义；sources 表待阶段 2 增补成六表（ADR-0013）
wrangler.jsonc                # D1 绑定；triggers.crons v1 留空（部署日启用）；database_id 仍是占位符
next.config.ts                # output export + dev rewrites /api/* → :8787
docs/prd/PRD.md               # 30 条 user stories + 实现决策汇总（已按 ADR-0013/0014 修订）
docs/adr/0001-0014.md         # 14 枚 ADR（0013 本地优先、0014 归属/检索简化为最新口径）
demo/index.html               # 设计原型（纯静态，无需构建）
```

## 重要运行事实

- v1 全程零 Cloudflare 登录：D1 走 wrangler 本地模拟（miniflare）；`wrangler dev --remote` 仅部署日联调。
- cron（北京 08-11 半点 6 次/天）、R2、Pages 部署均为部署日行为，v1 不生效。
- LLM 相关 env（`LLM_API_BASE` / `LLM_API_KEY` / `MAX_LLM_PER_RUN` 等）部署日 enrich 回填才生效；注意变量名是 `LLM_*`，不是 `OPENAI_*`。
- 解析半成功的 Item（缺摘要 / 缺 #N / 缺相关链接）仍入库，`enrich_state=pending`，前端做回退渲染。
- 所有 read API 端点在 Worker 内走 `caches.default` 60s 缓存（本地模拟下近似 no-op）。
- 错误响应统一 `{ error: { code, message } }`。
- `/api/items` 分页为按期分页 `?before_date=YYYY-MM-DD`（ADR-0014），无 cursor token。

## 工作目录规则

```text
前端命令在仓库根目录（npm run dev / npm run build）。
Worker 命令在仓库根目录用 wrangler（wrangler dev / wrangler d1 execute --local）。
backfill / sync：`npm run backfill` / `npm run sync` 在根目录执行（本地脚本，连本地模拟 D1）。
不切目录。
```

## 默认验证方式

```text
- 纯函数（parseMarkdown / matchCompanies）：`npm test <pattern>` 跑针对性 Vitest。
  测试位置自阶段 1 起于 worker/sync/ 同目录（parse.test.ts 等）+ worker/sync/fixtures/ 真实日报语料。
- Worker 行为：本地 `wrangler dev`（本地模拟 D1）手动验证 /api/* 响应。
  真实 LLM 调用、远程 D1 roundtrip 属部署日行为，不作默认验证。
- 前端：`npm run dev` 看视觉；`npm run build` 必须产出 out/ 静态产物验证导出无误。
- 类型与 lint：`npm run typecheck`、`npm run lint` 为 0-error 门禁（现存 5 处 warn 允许）；push/PR 由 CI（.github/workflows/ci.yml）跑 npm ci + typecheck + lint + build。
```

## 当前可维护性热点

- 升级版 Item 解析器已落 `worker/sync/parse.ts`（`parseIssue`）；`src/lib/juya.ts` 的 parseMarkdown 保持概览解析旧形态供首页使用，两者勿混用。
- `worker/registry.generated.ts` 是生成物——改公司白名单要改 `data/companies.yaml` 后跑 `npm run gen:registry`，勿手改生成物。
- 本地 D1 数据存于 `.wrangler/state/`（gitignored）；清空该目录即重置本地库，重跑 `wrangler d1 execute --local --file worker/sync/schema.sql` + `npm run backfill` 即恢复。
- lint 存量 5 处 warn（`react-hooks/set-state-in-effect`，DailyPage/ThemeToggle 挂载期同步模式）——spec 04 重写状态流时收敛，勿提前重构。
- 类型契约与 schema 已建（`src/lib/schema.ts`），但 Worker 与前端尚未消费——落地时务必匹配这套形状。
- `wrangler.jsonc` 里 `database_id` 当前是占位符 `REPLACE_WITH_REAL_D1_ID`（本地模拟不需要真实 id），部署日（阶段 6）才需替换。`secrets` 字段必须保持对象形态 `{ "required": [...] }`（wrangler ≥4.69 拒绝数组形态）。

## 后续会话约束

- 不要假设历史文档始终完全同步，应优先相信代码和本文件。
- 常规编码任务不要把历史日志或 ADR 当作必读材料；只在需要"为什么这样设计"时按编号查 ADR；v1 裁剪口径以 ADR-0013 / 0014 为准。
- 除非任务明确要求，不要擅自引入新的状态库、payload 结构或核心术语；术语以 `CONTEXT.md` 为准。
- 改 `companies.yaml` 不手动同步 D1（ADR-0001）。
- 不要在 v1 阶段引入 R2 / Vectorize / LLM 调用 / cron 触发器——这些是部署日动作（ADR-0013 / 0014）。
- 任何破坏 Item schema（ADR-0002）、白名单闸门（ADR-0001）、确定性归属（ADR-0003 段一 + ADR-0014）的改动，先回头读对应 ADR 再决策。

# Juya AI Daily Plus

把 [daily.juya.uk](https://daily.juya.uk) 每日发布的 AI 资讯合集按"事件流 + 公司"两个维度重新整理。**v1 本地优先**：D1 单存储引擎 + 手动同步，先做到本地可用，Cloudflare 部署后移（ADR-0013）。

> MVP 范围、30 条 user stories、14 枚架构决策记录见 `docs/prd/PRD.md` 与 `docs/adr/`（v1 裁剪口径见 ADR-0013 / 0014）。术语表见 `CONTEXT.md`。当前真相快照见 `docs/CURRENT_STATE.md`。

## 功能

- **日期阅读页** `/` — 当前期完整阅读页（v1 维持直连 daily.juya.uk 现状），日历切换往期，前后期导航
- **事件流** `/stream` — 跨期 Item 卡片流，按天分组、左侧 facet 筛选（公司 / 分类 / 日期范围）、按期分页
- **公司索引** `/company` — 全部登记公司卡片墙
- **公司档案** `/company/[id]` — 档案头五块（身份 / 活跃度 / 性质画像 / 行业关系 / 时间跨度）+ 该公司事件按时间倒序
- **6 套主题** — 经典 / 极简 / 沙丘 / 蓝图 / 墨夜 / 霓虹，data-theme 属性 + CSS 变量切换
- **手动同步** — `npm run sync` 增量抓新期：写 D1 `sources` 原文表、解析、确定性白名单匹配（v1 无 LLM）、upsert；部署日后由 cron 自动执行（ADR-0013 / 0014）

## 主题

| 主题 | 风格 |
|------|------|
| 经典 Editorial | 温暖纸张色调，Playfair Display 衬线标题 |
| 极简 Mono | 纯黑白，系统字体，零装饰 |
| 沙丘 Dune | 沙漠金棕，DM Sans 几何无衬线 |
| 蓝图 Blueprint | 工程蓝白，IBM Plex 等宽标题 |
| 墨夜 Ink | 深色模式，大字号宽行距 |
| 霓虹 Cyber | 赛博终端，等宽字体，霓虹色 |

## 技术栈

- 前端：Next.js 16（静态导出）+ React 19 + Tailwind CSS 4 + react-markdown + next-themes（v1 仅本地运行，不部署）
- 后端：Cloudflare Worker（REST read API + 共享 sync 模块；`scheduled` 入口预留，部署日启用 cron）
- 存储：D1 六张表（items / sources / companies / item_companies / enrich_cache / sync_log）——唯一存储引擎，无 R2（ADR-0013）
- 测试：Vitest（纯函数 `parseMarkdown` / `matchCompanies`；enrich 相关测试随部署日回填落地）

## 本地开发

需要两个终端（前端 dev + Worker dev），next.config rewrites 把 `/api/*` 代理到 `:8787`。D1 走 wrangler 本地模拟，**全程零 Cloudflare 登录**。

```bash
# 一次安装
npm install

# 终端 1：前端 dev（:3000）
npm run dev

# 终端 2：Worker dev（:8787，本地模拟 D1）
npx wrangler dev
```

同步参数通过 `.dev.vars` 注入（已 `.gitignore`）；LLM 相关参数部署日 enrich 回填才生效。

## 构建与回填

```bash
npm run build      # 前端静态导出，产物在 out/
npm run backfill   # 全量历史回填（阶段 2 实现，连本地模拟 D1）
npm run sync       # 增量同步新期（阶段 5 实现）
```

v1 不部署。Cloudflare Pages / Worker deploy / cron 启用集中在阶段 6「部署日」执行（见 `docs/plans/mvp-build-phases.md`），届时需替换 `wrangler.jsonc` 的 `database_id` 占位符，并 `npx wrangler secret put LLM_API_KEY`。

## 数据来源

[daily.juya.uk](https://daily.juya.uk) 由作者维护的每日 AI 资讯合集，提供 `/archive/` 期次索引与 `/markdown/<YYYY-MM-DD>.md` 原文。

## 项目结构

```text
juya-daily-pro/
├── CONTEXT.md                    # 术语表（Daily Issue / Item / Company / Role 等）
├── CLAUDE.md                     # coding agent 操作指南
├── demo/index.html               # 设计原型（纯静态，双击即看）
├── docs/
│   ├── prd/PRD.md                # MVP 范围与 user stories
│   ├── CURRENT_STATE.md          # 当前真相快照
│   ├── adr/0001-0014.md          # 14 枚架构决策记录（0013 本地优先、0014 v1 简化）
│   └── plans/
│       ├── product-engineering-roadmap.md  # 产品工程落地大纲（Phase 0-4）
│       └── mvp-build-phases.md             # MVP 内部 0-5 阶段 + 部署日执行计划
├── data/companies.yaml           # Company Registry 真相源（31 家种子）
├── src/                          # Next.js 前端
├── worker/sync/schema.sql        # D1 表定义（阶段 2 增补 sources 至六表）
└── wrangler.jsonc                # D1 绑定 + vars；crons v1 留空（部署日启用）
```

## License

ISC

# Juya AI Daily Plus

把 [daily.juya.uk](https://daily.juya.uk) 每日发布的 AI 资讯合集按"时间线 + 公司"两个维度重新整理，部署在 Cloudflare 上供多用户查阅。

> MVP 范围、30 条 user stories、11 枚架构决策记录见 `docs/PRD.md` 与 `docs/adr/`。术语表见 `CONTEXT.md`。当前真相快照见 `docs/CURRENT_STATE.md`。

## 功能

- **日期阅读页** `/` — 当前期完整阅读页，日历切换往期，前后期导航
- **时间线** `/timeline` — 按天分组的 Item 卡片流、左侧 facet 筛选（公司 / 分类 / 日期范围）
- **公司索引** `/company` — 全部登记公司卡片墙
- **公司档案** `/company/[id]` — 档案头五块（身份 / 活跃度 / 性质画像 / 行业关系 / 时间跨度）+ 该公司事件按时间倒序
- **6 套主题** — 经典 / 极简 / 沙丘 / 蓝图 / 墨夜 / 霓虹，data-theme 属性 + CSS 变量切换
- **自动同步** — Cloudflare Worker cron 在北京 08:00–11:00 半点抓取新期，归档到 R2、解析、白名单匹配、多家时 LLM enrich、upsert D1

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

- 前端：Next.js 16（静态导出）+ React 19 + Tailwind CSS 4 + react-markdown + next-themes，部署 Cloudflare Pages
- 后端：Cloudflare Worker（cron trigger + REST read API）
- 存储：D1（items / companies / item_companies / enrich_cache / sync_log 五张表）+ R2（原文归档 `daily/<YYYY-MM-DD>.md`）
- 测试：Vitest（纯函数 `parseMarkdown` / `matchCompanies` / 启发式 role 补全）

## 本地开发

需要两个终端（前端 dev + Worker dev），next.config rewrites 把 `/api/*` 代理到 `:8787`。

```bash
# 一次安装
npm install

# 终端 1：前端 dev（:3000）
npm run dev

# 终端 2：Worker dev（:8787，连远程 D1/R2）
npx wrangler dev --remote
```

本地 LLM key、同步参数等通过 `.dev.vars` 注入（已 `.gitignore`）。模板见仓库根 `.dev.vars`。

## 构建部署

```bash
# 前端静态导出
npm run build
# 产物在 out/

# Worker 部署
npx wrangler deploy
```

部署前需在 wrangler.jsonc 替换真实 D1 `database_id`，并 `npx wrangler secret put LLM_API_KEY` 创建生产环境密钥。

## 首次历史回填

本地脚本一次性把 daily.juya.uk 历史 archive 抓回 R2 并写 D1，不受 Worker 30s CPU 限制：

```bash
npm run backfill    # 待阶段 2 实现（见 docs/plans/mvp-build-phases.md）
```

## 数据来源

[daily.juya.uk](https://daily.juya.uk) 由作者维护的每日 AI 资讯合集，提供 `/archive/` 期次索引与 `/markdown/<YYYY-MM-DD>.md` 原文。

## 项目结构

```text
juya-daily-plus/
├── CONTEXT.md                    # 术语表（Daily Issue / Item / Company / Role 等）
├── AGENTS.md                     # coding agent 操作指南
├── docs/
│   ├── PRD.md                    # MVP 范围与 user stories
│   ├── CURRENT_STATE.md          # 当前真相快照
│   ├── adr/0001-0011.md          # 11 枚架构决策记录
│   └── plans/mvp-build-phases.md # 分阶段执行计划
├── data/companies.yaml           # Company Registry 真相源（30 家种子）
├── src/                          # Next.js 前端
├── worker/sync/schema.sql        # D1 五张表
└── wrangler.jsonc                # cron + vars + D1/R2 绑定 + secret
```

## License

ISC
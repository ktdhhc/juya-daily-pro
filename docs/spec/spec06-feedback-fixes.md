# Spec 06 · 用户反馈五连修（工程性，线性执行）

> 来源：2026-08-29 用户验收反馈五条。上游：ADR-0001（registry 镜像语义补全）、ADR-0012（搜索词进 URL）、FRONTEND_DESIGN（全部 UI 沿用既有语言，不新增契约章节）。
> registry 数据治理（产品并入母公司、补 13 家）已由主会话完成并提交（`674383c`，39 家），本 spec 负责 D1 应用、前端五修、契约扩展。

## 用户反馈 → 工程问题映射

| # | 反馈 | 根因 | 修复 |
|---|---|---|---|
| 1 | 公司索引一塌糊涂（WorkBuddy/TRAE 非公司、缺字节跳动徽章） | registry 把产品当公司、缺母公司 | ✅ 已治理（674383c）+ 本 spec D1 应用与重匹配 |
| 2 | 公司索引保留 10-12 家，其余折叠"其他" | 卡片墙全量平铺 | top-12 + 折叠区 |
| 3 | 点事件跳到日报顶部 | 阅读页客户端异步渲染，无人消费 location.hash | 数据就绪后消费 hash 并滚动 |
| 4 | 缺统一搜索框 | 无搜索入口/端点 | 报头搜索条 + `/api/items?q=` |
| 5 | 手动同步加前端按钮 | 同步只有 CLI | 报头同步按钮 + `POST /api/sync` |

## 契约扩展（钉死）

1. `GET /api/items` 新增 `q` 参数：与既有 facet 可组合；对 `title / summary / body_md` 做 `LIKE '%q%'`（`%`/`_`/`\` 转义，参数化绑定）；`q` 进 URL query（与 facet 同一双向同步机制，before_date 仍不进 URL）。
2. `POST /api/sync` → 在 Worker 内执行增量同步（与 `scripts/sync.ts` 同一纯函数与 SQL 生成，经 `env.DB.exec` 执行——SQL 全字面量无绑定参数，适配 exec）：响应 `{ ok: boolean, dates: string[], failures: { date: string, error: string }[] }`；运行中抛错 → 500 `{error:{code:"sync_failed",message}}`。守卫：`env.SYNC_TOKEN` 非空时要求请求头 `x-sync-token` 相等，否则 403 `unauthorized`；未设置（本地 .dev.vars 不配）则开放。`GET /api/sync` → 405。
3. `sqlgen` 新增 `companiesPruneSql(activeIds: string[]): string`：`DELETE FROM companies WHERE id NOT IN (...)` + `DELETE FROM item_companies WHERE company_id NOT IN (...)`（registry 镜像的删除语义，ADR-0001 补全）；空数组 → 空串。sync 脚本与 sync 端点每次运行都执行 prune。

## 执行步骤（两线并行）

### A 线 — Worker + D1 应用（agent A）

A1. sqlgen：`companiesPruneSql` TDD（红→绿，含空数组/转义/纪律）。
A2. queries：`buildItemsDatesQuery` / `buildItemsForDatesQuery` 接受 `q`（TDD：转义用例——含 `%`/`_` 的 q 不作通配符；与 company/category/from/to 组合）。
A3. routes：`q` 参数接入两个查询；`POST /api/sync`（守卫 + 复用 `worker/sync/pipeline.ts` 的 selectSyncDates 与 sqlgen 全家 + `env.DB.exec`；单期容错同脚本；`fetch` 在 Worker 运行时原生可用）。注意 Worker CPU ~30s：增量窗口通常 ≤4 期没问题，全量场景由 backfill 承担——端点内不提供全量模式。
A4. D1 治理应用：跑一次 `npm run sync`（upsert 39 家新 registry + companiesPruneSql 清 trae/workbuddy/amp/internlm/modelscope 旧行）→ `npm run match:all` 全量重匹配 → 统计前后对比（0/1/≥2 分布、missing_owner 数、新增公司条数：zhipu/deepseek/bytedance/xiaomi/antgroup/xiaohongshu/huggingface/apple/midjourney/stabilityai/thinkingmachines/blackforestlabs/sourcegraph）。
A5. happyoyster 判定：查其 2 条 Item 的 title/body，若明显快手系 → 并入 kuaishou alias（改 yaml + gen:registry + 重复 A4 的 prune+重匹配）；若独立品牌无母公司信号 → 保留并在汇报说明证据。
A6. 验证：curl `/api/items?q=Claude&limit=2`（命中且含 % 转义用例）、`curl -X POST /api/sync`（或带 token 形态）、四门禁绿。

### B 线 — 前端五修（agent B，契约钉死可并行）

B1. **锚点修复**：DailyPage 在 initialData 就绪与 handleSelect 完成后，若 `location.hash` 匹配 `#article-\d+` → 复用 ArticleView 的滚动逻辑滚到对应 h2（元素不存在则静默留顶部）；导出/上移 scrollToId 避免重复实现。
B2. **公司索引 top-12 + 折叠**：`/company` 默认只渲染 total 前 12 家；其余进「其他 N 家」折叠区（同款细线分格网格 + 文字链展开/收起，墨点状态）；搜索时折叠自动全开。
B3. **统一搜索框**：报头加放大镜 icon-btn（全视图可见）→ 点击展开报头下方全宽搜索条（`.control-input`，fade-up，Esc 收起）→ Enter 跳 `/stream?query=<term>`；`/stream` 上 query 作为 facet chip 显示（可清除），并纳入 facet↔URL 双向同步。
B4. **同步按钮**：报头右侧 icon-btn（刷新箭头，全视图可见）→ `POST /api/sync` → 运行中图标旋转、完成后展开细线小条「同步 N 期 · 失败 M」（fade-up，约 5s 自散）；失败显示错误一行 + 重试文字链。403 时提示「需要同步令牌」。
B5. 验证：`npm run build` 绿（含 /company/39 静态页——注意 generateStaticParams 随 registry 变为 39）；四门禁绿；FRONTEND_DESIGN §6 三问自查新组件。

### C 线 — 集成与浏览器验证（主会话）

双进程 → 浏览器核对：/company 折叠态与展开态、治理后的徽章（点开 TRAE 条目应显示字节跳动）、搜索流（报头 → /stream?query=）、锚点跳转（/stream 点「看原期」→ 落到对应条目）、同步按钮全流程。review 一轮后提交。

## 验收清单

- [ ] D1：companies = 39、无 trae/workbuddy/amp/internlm/modelscope 旧行；missing_owner 显著下降（治理前 242，汇报新值）
- [ ] `q` 搜索与 facet 组合正确、转义安全（单测）
- [ ] `POST /api/sync` 幂等可重跑；SYNC_TOKEN 守卫生效
- [ ] 锚点跳转：/stream 点条目 → 阅读页滚到对应 h2
- [ ] /company top-12 + 折叠；报头搜索条与同步按钮按 FRONTEND_DESIGN 语言落地
- [ ] 四门禁绿；build 静态页 = 39 家 + 4 路由
- [ ] 零登录、零 LLM

## 边界

- 不做 FTS5/高亮（Phase 2 正式检索）；不做 retry queue；不改 6 主题变量语义。
- registry 治理已提交，agent 只做 D1 应用与统计；不再改 yaml（happyoyster 判定除外，需汇报证据）。

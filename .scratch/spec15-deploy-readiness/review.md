# Review · spec15 部署就绪与定时自动化（2026-09-08，双轴审查：Spec × Standards）

**结论：PASS**（无 P0/P1；P2 四项当场处置，P3 记录）

## 审查方式

`code-review` 技能双轴并行子 agent，固定点 `4619356`，范围 `git diff 4619356...HEAD`（15 文件 / +419 −184）。
- **Spec 轴**：逐票核对交付与 spec/票面要求；结论——票 01/02/04/05 通过，票 03 逻辑通过（假 D1 直调四分支验证）。
- **Standards 轴**：AGENTS.md + Fowler 基线；结论——新纯函数测试只测外部行为、无同义反复、无孤儿代码、无新依赖。

## P2（已当场处置）

1. **首部署 secret 先有鸡先有蛋**（Spec 轴，`wrangler.jsonc:27`）：`secrets.required` 含 ADMIN_TOKEN 后，Worker 尚不存在时 `wrangler deploy` 直接报缺 secret，而此刻 `wrangler secret put` 也不可用（需 Worker 已存在）。
   → 处置：部署清单改用 `wrangler deploy --secrets-file <本地文件>` 一次完成部署+注入；该文件写入 `.gitignore`（永不入库）。CURRENT_STATE 部署段同步。
2. **代理静默吞异常**（Standards 轴，`functions/api/[[path]].ts:52,73`）：两处裸 `catch {}` 直接 502，无日志无原因，偏离仓库 `console.error` 惯例。
   → 处置：两处补 `console.error` 并在 502 message 附原因摘要（排障可用）。
3. **票 03/05 票面缺证据记录**（Spec 轴）：实现与主会话实测证据齐全（见下），但票文件未勾选/未记。
   → 处置：回填票面证据与勾选。
4. **部署清单未记 `WORKER_ORIGIN`**（Spec 轴）：Pages 项目变量只存在于代码注释。
   → 处置：部署清单显式列出（Pages 项目变量 `WORKER_ORIGIN` = Worker 地址）。

## P3（记录，不立项）

- `isApiPath` 放行裸 `/api`，注释称与 CF `/api/*` 口径一致但未验证；实际裸 `/api` 不进函数（`_routes.json` 只含 `/api/*`）→ 已修注释为准确表述。
- 薄壳把一切错误压成 500 `sync_failed`（核心当前只抛普通 Error，无行为变化）→ 已补注释说明边界。
- `dates` 一词两义（窗口 vs 成功期）→ 不改（既有响应契约字段名，改名属破坏性变更）。
- cron 侧重复 `parseBusy` 守卫 + 圈题两段协议 → 记录；两处陈旧策略需同步维护。
- 文档未同步（PRD 参数表 / ADR-0006 已删变量）→ 随本 spec 收尾更新。

## 主会话独立验收证据（三条缝）

- **缝 1**：`parseDbTarget` 4 例 + `isApiPath` 6 例 = 10/10 绿。
- **缝 2**：独立起 8788 `--test-scheduled`，触发 → 200「Ran scheduled event」，sync_runs +1 行（15:42:39 · ok · 窗口 4 期 · 1606ms），日志「同步完成：写入 4 期，暂存 0 条，失败 0 期」+「无待解析目标，跳过解析」（零 LLM、零入库）。
- **缝 3**：pages dev 代理 vs 直连解码后字节一致（2415B，sha 相同）；静态 `/` 与 `out/index.html` 字节一致；POST /api/sync 透传 200。
- 门禁：vitest 373 / 双 tsc / eslint 0 error / build 46 页。

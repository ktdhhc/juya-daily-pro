# 适用范围

本文件适用于位于 `D:\1project\juya-daily-plus` 仓库的整体。
将其作为在本仓库中工作的 coding agent 的默认操作指南。

> 本文件只写"应该如何工作"。当前是什么（架构、主流程、文件地图、运行事实）见 `docs/CURRENT_STATE.md`；术语见 `CONTEXT.md`；方案与决策见 `docs/adr/`、`docs/prd/PRD.md`、`docs/plans/`。

## 一、全局 Agent 原则

### 1. 编码前先思考

不要想当然。不要掩饰困惑。要把权衡摆到明面上。在开始实现之前：

- 明确说明你的假设。如果不确定，就提问。
- 如果存在多种理解方式，把它们都说出来，不要默默选一种。
- 如果有更简单的方法，就直接指出来。必要时要敢于提出异议。
- 如果有不清楚的地方，就先停下来。

### 2. 简单优先

只写解决问题所需的最少代码。不做任何猜测性扩展。

- 不添加任何超出要求的功能。
- 不为一次性代码做抽象。
- 不加入未被要求的"灵活性"或"可配置性"（本项目所有可调参数已经在环境变量里，详见 `wrangler.jsonc` 与 `.dev.vars`，不需要新加 config 入口）。
- 不为极不现实的场景编写额外错误处理。
- 如果 50 行就能完成，就不要保留 200 行实现。

### 3. 外科手术式修改

只改必须改的地方。只清理由你自己改动引发的问题。

- 不要"顺手优化"邻近代码、注释或格式。
- 不要重构那些本来没坏的东西。
- 要匹配现有局部风格，即使你自己平时会写成另一种样子。
- 如果注意到无关的死代码，可以指出，但不要直接删除，除非被明确要求。
- 当你的改动制造出"孤儿内容"时：删除因你改动而未使用的 import、变量、函数；不要删除原本就存在的死代码，除非用户明确要求。

检验标准：每一行修改，都应该能够直接追溯到用户请求。

### 4. 以目标驱动执行

先定义成功标准。然后持续推进，直到验证通过。把任务转化为可验证的目标：

- "新增解析分支" → 先为该分支写一条 Vitest 单测，再让它通过。
- "升级 LLM enrich" → 先确认一条真实多家公司命中样本的预期，再让 enrich 结果匹配。
- "改 D1 schema" → 改 `worker/sync/schema.sql` 后跑 `npm run backfill` 万万使不得（一次性、CPU 时长限制走本地）；只对受影响区间重跑。

对于多步骤任务，先给出一个简短计划：

```text
1. [步骤] → 验证：[检查方式]
2. [步骤] → 验证：[检查方式]
3. [步骤] → 验证：[检查方式]
```

## 二、个性开发习惯

### 1. 开发与验证习惯

- 前端命令在仓库根目录下执行（`npm run dev`、`npm run build`）。
- Worker 命令在仓库根目录下用 wrangler 执行（`wrangler dev`、`wrangler deploy`），通过 `wrangler.jsonc` 配置。
- 一次性回填与增量同步命令在根目录下 `npm run backfill` / `npm run sync`（本地脚本，连 wrangler 本地模拟 D1，零 Cloudflare 登录；见 ADR-0013）。
- 前端文件避免全部写在同一个大文件里；新增组件按职责拆分到 `src/components/`。
- 优先运行有针对性的 Vitest 测试，不要每次默认 `npm test` 跑全量。
- 高成本集成检查（真实 LLM 调用 / 远程 D1 roundtrip）不作为默认快速验证方式。

### 2. 代码风格约束

- 后端（`worker/`）：
  - TypeScript strict 模式。
  - API 路由保持精简，业务逻辑放在 service 层或既有等价层。
  - 所有可调参数走环境变量（Cloudflare Worker `vars`/`secrets`），不要硬编码频率、模型 ID、URL 等可调项。
- 前端（`src/`）：
  - 客户端 fetch 统一走相对路径 `/api/*`，不要写绝对 URL（dev 走 next.config rewrites、生产走 Pages Functions 同域代理）。
  - 网络错误统一返回 `{ error: { code, message } }` 格式，前端 fetch 层集中处理。
  - 派生状态与请求协调在页面级 `useState` + `useEffect` 中完成，不引入 zustand 等状态库（除非 PRD 明确变更）。

## 三、文档目录与读取建议

### 默认优先读取

#### `docs/CURRENT_STATE.md`

- 用途：当前仓库的"当前真相"快照（架构、主流程、关键入口、重要运行事实、可维护性热点）。
- 读取时机：后续 agent 会话默认优先阅读。
- 注意：保持短、小、稳，只记录当前仍然有效的事实。

#### `docs/prd/PRD.md`

- 用途：MVP 范围、30 条 user stories、实现决策与 ADR 索引。
- 读取时机：进入新功能开发、确认用户价值边界、查阅 API 形状时。

#### `CONTEXT.md`

- 用途：本项目专用术语表（Daily Issue / Item / Category / Primary Link / Related Links / Company / Company Registry / Role）。
- 读取时机：写文案、写 prompt、写 UI 时确保术语一致。
- 注意：CONTEXT.md 完全 devoid of 实现细节，不读它你仍能编码；读了它能避免术语错位。

### 按需读取

#### `docs/adr/`

- 适合：需要确认"为什么这样设计"时按编号查特定 ADR。
- 不应作为默认首读材料。
- 与本文件冲突时，以 ADR 为准（ADR 是更细的权衡记录）。

#### `docs/plans/`

- 适合：在实现具体 feature 或回看方案演进时按需读取。
- 不应作为默认首读材料。

## 四、推荐读取顺序

对于大多数日常开发任务，推荐使用下面的最小读取顺序：

1. 先读 `docs/CURRENT_STATE.md`。
2. 再读与当前任务直接相关的代码文件。
3. 再读相关测试文件（Vitest 测试位置在阶段 1 起于 `worker/sync/parse.test.ts` 等同目录，纯函数 suite）。
4. 只有任务涉及前端表现时，临时参考 `src/app/globals.css` 中 6 套主题变量与 `src/components/` 既有 6 个组件（用户已暂缓写 `docs/FRONTEND_DESIGN.md`）。
5. 只有需要历史背景或方案依据时，读 `docs/adr/` 中的相关 ADR 或 `docs/plans/` 中的方案文档。
6. 当术语模糊时，读 `CONTEXT.md`。

## 五、使用原则

- 优先相信代码和 `docs/CURRENT_STATE.md` 中仍然有效的事实。
- 不要把历史文档和方案文档当作默认最小上下文。
- 如果当前任务只涉及一个功能区（前端 / Worker / D1 schema / 白名单），只读该功能区代码、测试和必要文档。
- 保持低上下文、强边界、局部验证的开发方式，避免无必要的全仓重读。

## 六、Agent 修改检查清单

- 修改行为前，先阅读被触及模块及其附近测试。
- 在发明新的命名和载荷结构之前，先匹配 `src/lib/schema.ts` 中已有类型形状。
- 对 Worker 行为改动，更新或补充 `worker/` 内的 Vitest 单测覆盖（parse / match / enrich 都需覆盖）。
- 改动 `data/companies.yaml` 后**不要**手动同步 D1——它是自动同步的（ADR-0001 v2 D 变体），手动同步会引入双写源。
- 改动 `wrangler.jsonc` 后，检查 vars 与 secret 引用是否仍然与 Worker 入口读取的字段对齐。
- 改动 `next.config.ts` 时保留 `output: "export"` 与 `images.unoptimized`，dev rewrites 不可省。
- 先运行最小必要验证，再逐步扩大检查范围。
- 如果改动影响 cron 同步、LLM enrich 缓存、D1 upsert 幂等性，考虑竞争条件与过期缓存问题。
- 不把 `docs/FRONTEND_DESIGN.md` 内容塞进其它文档——用户已明确要求暂缓该文档。

## 七、不确定时

- 优先做最小、局部的改动，而不是大范围重写。
- 保持行为可追溯、关键证据可保留、流程可恢复。
- 保持文档与行为一致；如果重大工作流假设发生变化，更新 `docs/CURRENT_STATE.md` 或相关 ADR。
- 如果新增架构权衡满足"难逆转 + 不读会困惑 + 真实取舍"三条，写新 ADR 进 `docs/adr/`（编号递增、格式见 ADR-FORMAT）。
- 如果仅是术语边界变化，更新 `CONTEXT.md` 的 `_Avoid_` 标签。

## 八、Agent skills

### Issue tracker

本地 markdown 票仓：spec 在 `docs/spec/`，实施票在 `.scratch/<spec-name>/issues/`。See `docs/agents/issue-tracker.md`.

### Triage labels

五个标准 triage 角色，默认命名，以 issue 文件内 `Status:` 行记录。See `docs/agents/triage-labels.md`.

### Domain docs

单上下文仓库：先读 `docs/CURRENT_STATE.md`，术语以 `CONTEXT.md` 为准，ADR 按需查。See `docs/agents/domain.md`.
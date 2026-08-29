# 03 · 候选公司提议作业：propose-companies → companies-pending.yaml（存量回填）

Status: ready-for-agent

> 2026-08-29 修订：本票定位为**存量数据回填**（对已入库历史数据离线批跑）；新增数据的候选提议将出现在 spec10 审核页（复用本票纯函数）。纯函数位置改为 `src/lib/llm/propose.ts`。

## What to build

按 `docs/spec/spec09-llm-curation.md` Step 3（3.1→3.3）执行。前置：`scripts/lib/llm.ts` 已交付。

### 3.1 纯函数（先红后绿）

`src/lib/llm/propose.ts`：

- `buildProposePrompt(item: { title: string; summary: string; bodyMd: string }, registryNames: string[]): { system: string; user: string }`
  - 三分类判别任务说明：①活跃科技/AI 公司（不在册 → 建议入册）②已入册公司的产品/子品牌 → 指认 parent ③无关实体（人名/论文/会议/地名等）→ ignore。
  - registryNames = 全部在册公司名（供排除幻觉 parent）。bodyMd 同样 4000 字符截断。
- `parseProposeResponse(raw: string, registryNames: string[]): ProposeVerdict | null`
  - 输出仅 JSON：`{kind:"company", id, name, aliases, evidence}` / `{kind:"product", parent, evidence}` / `{kind:"ignore"}`。
  - 校验：kind 合法；company 分支 id 为合法 slug（`/^[a-z0-9]+(-[a-z0-9]+)*$/`）且 name 非空；**product 分支 parent 必须 ∈ registryNames，不在册 → 返回 null（幻觉 parent 不可信）**；ignore 直接过。任何不合法 → null。
- 建议输出的 id/name/aliases 为 LLM 建议值，最终由人工审。

**TDD**（你没有 skill，按此手工执行）：`src/lib/llm/propose.test.ts`。用例：
1. prompt 快照（含 registry 名单样例与三分类说明）
2. parse：三分类各一例合法 / 幻觉 parent（不在 registryNames）→ null / id 非 slug → null / 非法 JSON → null / kind 未知 → null
3. bodyMd 4000 字符截断边界
先红后绿，贴证据。

### 3.2 `scripts/propose-companies.ts`（`npm run propose:companies`，package.json 加一行 script）

流程：loadLlmConfig → wrangler-cli 读 D1：missing_owner 条目（`SELECT ... FROM items WHERE enrich_state='missing_owner' ORDER BY id`，`--limit` 默认 40/轮）+ 在册公司名清单 → `runWithLimiter` 逐条判别 → **不直接入册**：结果合并（按建议 id 去重，同 id 保留 evidence 最多 3 条）追加写 `data/companies-pending.yaml`（不存在则创建；YAML 手工拼装——键序 id/name/aliases/confidence/reason/source，source=item id 可溯源；字符串一律单引号包裹并转义单引号）→ 报告：company/product/ignore 分布 + 建议清单（id/name/evidence 摘要）。
- confidence 简单三档（high/mid/low，依据证据强度——是否含域名/官方产品名），规则写进注释。
- pending 文件若已存在则**读入合并去重**（按 id），不覆盖旧内容。

### 3.3 人工流程演示（一次性）

跑完一轮后在汇报里演示人工流程路径（不必真搬）：pending → 认可条目手工搬 `data/companies.yaml` → `npm run gen:registry` → `npm run sync` + `npm run match:all` → missing_owner 下降。**LLM 永不直接改白名单**——本票代码不得写 companies.yaml / registry.generated。

## 红线

- 禁止 git commit / git add。
- 只允许改动：`src/lib/llm/propose.ts`（新建）、`src/lib/llm/propose.test.ts`（新建）、`scripts/propose-companies.ts`（新建）、`data/companies-pending.yaml`（新建，运行产物）、`package.json`（仅加 `propose:companies` script 一行）。其他文件不碰。
- 真实 LLM 调用：本轮默认跑一次（默认 40 条上限）作为验收；不重复全量。
- 禁止打印 .env 内容与 key 值；禁止改动 `data/companies.yaml`。
- YAML 拼装注意单引号转义与多行 reason（用 `>-` 折叠或保持单行）。

## Acceptance criteria

- [ ] propose 纯函数单测红→绿（三分类 + 幻觉 parent + slug 校验 + 非法 JSON + 截断边界）
- [ ] `npm run propose:companies` 真实跑通一轮：pending 文件产出，每条带 source；分布统计贴报
- [ ] `git status` 显示 `data/companies.yaml` 与 `src/lib/registry.generated.ts` 未被修改
- [ ] `npx tsc --noEmit` 绿

## Blocked by

.spec09-llm-curation/issues/01-llm-access-layer.md（已交付）

# 02 · 前端：审核台收件箱化——三态分组/解析结果常驻/入库预览/同步历史

Status: ready-for-agent

## What to build

按 `docs/spec/spec12-review-inbox.md` 契约 B/C/D/E/F（前端部分）执行。**只动 src/ 与 docs/FRONTEND_DESIGN.md，零 worker。** 服务端契约（并行 agent 交付，按此开发勿等待）：
- `POST /api/sync` 响应增 `stagedItems: number`（stagedDates 语义不变）
- `GET /api/review/history?limit=30` → `{ history: [{ date, status, error, attemptedAt, items, published, attributed }] }`

### 2.1 三态分组纯函数（先红后绿）

新建 `src/lib/review.ts`：
```ts
categorizePending(items: PendingItem[]): { unparsed: PendingItem[]; parsed: PendingItem[]; noNeed: PendingItem[] }
```
- 待解析 unparsed：owners≥2 且无 proposal，**或** enrichState/candidate 缺失的 missing_owner（payload 条目 owners.length===0 且 id 无 proposal 也归此类——以 enrichState 字段判断：payload 的条目需带 enrichState，若 PendingItem 无此字段则在 api.ts 类型补上并确认 /api/review/pending 有返回，没有就汇报差异勿改 worker）
- 已解析 parsed：owners≥2 且有 proposal
- 无需解析 noNeed：其余（单家归属等）
- 组序 = unparsed → parsed → noNeed
- **TDD**：`src/lib/review.test.ts` 三态各一例 + missing 归待解析 + 组序；先红后绿贴证据。

### 2.2 /review 页重排（src/app/review/page.tsx + src/components/review/）

- **顶部状态条**：三态计数（待解析 X · 已解析待确认 Y · 无需解析 Z）——由 categorizePending 得出，rule-t 分隔 tabular。
- **解析区（ParsePanel 改造）**：「运行解析」按钮保留；响应整体存 `localStorage["juya-last-parse"]`（`{ at, processed, candidatesFound, remaining, errors }`）；页面常驻展示最近一次结果（时间 + 成功/候选/余量 + **逐条错误「itemId · 原因」**）；errors 非空或 remaining>0 → 显示「再跑一次」提示文字（解析幂等只补漏）。
- **条目区**：按三态分组渲染（组标题带计数，待解析组排最前）；组内条目行沿用既有 ProposalEditor；**missing_owner 条目行内**显示「候选公司：name（待入册）」（candidate 字段已有）。
- **PublishBar**：勾选变化实时预览「将入库：N 期 · M 条（建议生效 K 条 · 无建议 L 条按当前归属直接入库）」——K/L 由勾选期内条目的 proposal 有无统计；确认按钮文案「确认入库（M 条）」。
- **同步历史折叠区**（新增 `src/components/review/HistoryPanel.tsx`）：默认折叠；展开懒加载 fetchReviewHistory；每行 = 日期 / 成败点标（ok 墨点、失败朱橙）/ 同步时间（MM-DD HH:mm）/ 条数 / 入库状态（published>0「已入库」、=0 且 items>0「待审核」、items=0「无条目」）/ 失败行显错误原因；「展开条目」→ fetch `/api/items?date=<d>&limit=31`（公开端点）拉该期条目，行式清单（标题 + 分类 + 归属徽章带主次，LogoSeal 复用）；「查看日报」→ Link `/?date=<d>`。

### 2.3 Header 同步条

成功文案改为「同步 N 期 · M 条待审核」（M=stagedItems，0 时省略）+「查看审核」文字链（Link href="/review"）；成功条自散时长 5s→15s。

### 2.4 api.ts 与设计契约

- `SyncResponse` 加 `stagedItems: number`；新增 `ReviewHistory` 类型 + `fetchReviewHistory(limit=30)`。
- `docs/FRONTEND_DESIGN.md` 追加「§4.12 审核台」（收件箱语言：三态计数、解析错误常驻、入库预览、同步历史行式；风格对齐现文）。

## 红线

- 禁止 git commit / git add。
- 只允许改动：`src/lib/review.ts`（新建）、`src/lib/review.test.ts`（新建）、`src/lib/api.ts`、`src/app/review/page.tsx`、`src/components/review/`、`src/components/Header.tsx`、`docs/FRONTEND_DESIGN.md`（§4.12）。禁止碰 worker/、scripts/、next-env.d.ts。TS strict；不新增依赖；配色只用既有变量；中文注释。
- 门禁：`npx tsc --noEmit` 绿；`npx eslint` 改动文件 0 error；`npx vitest run` 全量绿（292+ 不得回归）；`npm run build` 46 页。浏览器走查主会话做。

## Acceptance criteria

- [ ] categorizePending 红→绿证据；全量 vitest 绿
- [ ] 汇报：审核台五块布局说明（状态条/解析区/三态分组/预览/历史区）+ 契约差异清单 + 门禁输出

## Blocked by

None（worker 端点由并行票交付，按契约开发）

# Spec 01 · 解析器重构：完整 Item 解析 + fixtures（工程性，线性执行）

> 上游依据：`docs/plans/mvp-build-phases.md` 阶段 1；ADR-0002（Item schema）、ADR-0008（半成功入库）、ADR-0011（测试策略：只测纯函数）。
> 本文可按顺序逐步执行，每步有产出与验证命令。不做本文之外的事。

## 目标

在 `worker/sync/parse.ts` 落地**完整 Item 解析纯函数** `parseIssue`，把一期 Daily Issue markdown 拆成结构化 `Item[]`；建立 Vitest 基建与真实日报 fixtures 快照测试。**不改任何现有运行时行为**（首页用的 `src/lib/juya.ts` parseMarkdown 保持原样）。

## 前置事实（已核验）

- 真实 fixtures 已就位：`worker/sync/fixtures/2026-08-27.md`（19 条 Item）、`worker/sync/fixtures/2026-08-25.md`（14 条 Item）。
- 日报结构（两份 fixture 核验）：
  1. 首行封面图 `![](url)`；标题行 `# AI 早报 YYYY-MM-DD`（日期在此提取）；`**视频版**：…` 行；`## 概览` + `### 分类名` + `- 条目 [↗](url) \`#N\``；`---` 结束概览。
  2. 正文按 `## <分类名>` 分节（与概览分类同名），节内条目以 `### [` 开头：`### [标题](主链接) \`#N\``；随后 `> 摘要` 一行、若干正文段落/图片、`相关链接：` 列表（`- [url](url)` 形态）；条目间 `---` 分隔。
  3. 文末固定尾行：`**提示**：内容由AI辅助创作，可能存在**幻觉**和**错误**。`（在最后一个 `---` 之后，不属于任何 `## 节`，**不得**产出 Item）。
- `src/lib/schema.ts` 已有 `Item` 类型（含 sequenceInt / owners / enrichState）；`tsconfig` include `**/*.ts` 覆盖 `worker/`，typecheck 会检查新文件。
- package.json 现有 scripts：dev / build / start / typecheck / lint。无 vitest。

## 执行步骤（线性）

### Step 1 — Vitest 基建

1.1 devDeps 安装 `vitest`（记录版本）。
1.2 package.json scripts 加 `"test": "vitest run --passWithNoTests"`。
1.3 验证：`npm test` 退出码 0（此刻无测试文件）；`npm run typecheck`、`npm run lint`、`npm run build` 仍全绿。

### Step 2 — `worker/sync/parse.ts` TDD 实现

2.1 函数契约（**只此一个导出函数**，纯函数、无 IO、无 CF 专属 API）：

```ts
import type { Item } from "../../src/lib/schema";

export interface ParsedIssue {
  date: string;      // "YYYY-MM-DD"，取自 "# AI 早报 YYYY-MM-DD"；缺失则抛 Error("issue date not found")
  items: Item[];
}
export function parseIssue(md: string): ParsedIssue;
```

2.2 解析规则（全部规则均有对应测试，先写测试看红再实现）：

- **区域划分**：`## 概览` 到其后的 `---` 为概览区（跳过）；其余 `## <分类名>` 节为正文区（`## 概览` 本身不是分类）；`## ` 节之外的内容（文首元信息、文末提示尾行）不产出 Item。
- **条目头**：正文区 `### ` 行。带主链接：`### [标题](url) \`#N\``；无主链接：`### 标题 \`#N\``（标题不包 `[]`）。`#N` 可缺失。
- **id**：有 `#N` → `YYYYMMDD-N`（N 为整数，保留前导去零）；无 `#N` → `YYYYMMDD-x<k>`（k = 当期无编号条目的 1-based 序）；与已有 tagged id 冲突的 `#N` 重复同样落到 `-x<k>`。tag 写原文（`#N`，缺失留空）。
- **sequenceInt**：`#N` 整数值；缺失 0。
- **category**：所在 `## 节` 名；条目落在任何节外（防御性，正常不发生）→ `""`。
- **summary**：条目头之后第一条 `> ` 行的 `> ` 后原文；缺失 → `""`。
- **bodyMd**：summary 行之后到 `相关链接：` 行之前的内容，trim 掉首尾空行与 `---` 分隔线；无正文 → `""`。图片行保留在 bodyMd 内。
- **relatedLinks**：`相关链接：`（全角冒号或半角）之后的 `- [x](url)` / `- url` 列表，存 url；该块到空行后接 `---`、`## ` 或文件尾为止。缺失 → `[]`。
- **owners / enrichState**：owners 恒为 `[]`（归属是 spec 03 的事）；只要发生任一半成功（缺 summary / 缺 #N / 缺相关链接 / category 为空）→ `enrichState: "pending"`，否则 `"ok"`——**注意**：ADR-0008 中 `missing_owner` 由匹配阶段（spec 03）写入，解析阶段只产 `ok | pending`。
- **date**：从 `# … YYYY-MM-DD` 标题行提取；文件中无日期 → 抛 `Error`。

2.3 测试 `worker/sync/parse.test.ts`：
- **快照（防结构漂移）**：对两份 fixture 各做两枚快照——①条目投影摘要 `items.map(i => ({id, tag, sequenceInt, category, title, hasLink: !!primaryLink, summaryLen, links: relatedLinks.length, enrichState}))`；②首个 Item 的完整对象。快照 diff 即日报结构异常的 CI 报警。
- **边界 case（inline 小 md 断言）**：无主链接条目；缺 `#N`（id fallback + sequenceInt 0）；缺 `>` 摘要；缺相关链接块；重复 `#N` 落 `-x<k>`；文末提示尾行不产出 Item；无概览区/无 `---` 时正文仍可解析；无日期抛错。
- 断言计数：fixture 2026-08-27 → 19 条、2026-08-25 → 14 条（写死在测试里，防漏读）。

2.4 验证：`npm test parse` 全绿；`npm run typecheck` 0 错；`npm run build` 成功（parse.ts 尚无消费方，构建不受影响）。

### Step 3 — 收尾核验

`npm test` / `npm run typecheck` / `npm run lint` / `npm run build` 四绿。fixtures 与测试一并入库。

## 验收清单

- [ ] `npm test` 全绿，含 2 份 fixture 快照 + ≥8 个边界 case
- [ ] fixture 计数断言：2026-08-27 = 19 条、2026-08-25 = 14 条
- [ ] `npm run typecheck` / `npm run lint` / `npm run build` 全绿
- [ ] `src/lib/juya.ts` 未被改动（首页行为不变）
- [ ] parse.ts 为纯函数（grep 无 fetch / process / Node API 依赖）

## 边界

- 不实现 owners 匹配（spec 03）、不建 D1/回填（spec 02）、不引入任何依赖除 vitest。
- 不改 `src/lib/juya.ts`、不动 `src/` 下任何文件（schema.ts 只做 type-only import）。

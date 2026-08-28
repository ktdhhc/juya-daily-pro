# Spec 00 · 阶段 0 清债（工程性，线性执行）

> 上游依据：`docs/plans/mvp-build-phases.md` 阶段 0；ADR-0013（首页 v1 维持直连）。
> 本文是可按顺序逐步执行的工程文档，每步有明确产出与验证命令。不做本文之外的事。

## 目标

清掉历史债，建立质量门禁（typecheck / lint / CI），为后续所有 spec 提供干净的基线。**零行为变更**（除文件名与死代码移除）。

## 前置事实（已核验）

- `node_modules` 已安装（npm install 完成）。
- `src/app/globals.css:118-133` 附近存在 `.site-badge` 及其 5 个主题变体；全仓无任何组件引用 `.site-badge`（已 grep 核验）。其中 `[data-theme="mono"]` 变体引用了未定义变量 `--botanical-gold-soft` / `--botanical-gold`。
- `package.json` 现有 scripts：dev / build / start，无 typecheck / lint / test。
- `tsconfig.json` 已是 strict。
- 无 `.github/` 目录（deploy.yml 已在 plus 分支删除）。
- `src/lib/github.ts` 被 `src/app/page.tsx` 与 `src/components/DailyPage.tsx` 导入（fetchDailyList / fetchDailyContent / parseMarkdown / DailyEntry / ParsedDaily / MD_BASE）。**首页依赖这些导出直连 daily.juya.uk，本 spec 不得改变该行为。**

## 执行步骤（线性）

### Step 1 — globals.css 死代码清除

1.1 删除 `.site-badge` 全部规则（主规则 + 全部 `[data-theme=...]` 变体）。
1.2 全仓 grep `site-badge` 与 `botanical`：必须零命中（globals.css、tsx、ts 均不含）。若 `--botanical-*` 变量在别处仍有定义或引用，一并删除定义与引用（它们是同名已废弃主题的残留）。
1.3 验证：`npm run build` 成功；页面加载无样式回归（spec 04 前不要求视觉核对，只要求无编译错误）。

### Step 2 — typecheck 门禁

2.1 `package.json` 加 `"typecheck": "tsc --noEmit"`。
2.2 跑 `npm run typecheck`。若有存量类型错误：**最小修复**（只修类型表达，不改运行时行为），每个修复在 commit message 里点名。
2.3 验证：`npm run typecheck` 退出码 0。

### Step 3 — eslint 最简配置

3.1 安装 devDeps：`eslint` 与 `eslint-config-next`（版本与 Next 16 兼容；用 npm 安装实际解析到的版本）。
3.2 新增 `eslint.config.mjs`（flat config），内容为最简可用：继承 `next/core-web-vitals` + `next/typescript`，忽略 `.next/`、`out/`、`worker/`（worker 在 spec 02 起才有代码，先不纳入 lint 范围）。
3.3 `package.json` 加 `"lint": "eslint ."`。
3.4 跑 `npm run lint`：若有存量报错，允许对**既有代码**的样式类规则关闭或降级为 warn（在配置里精确列出规则名），但不允许关闭 no-unused-vars、no-undef 类正确性规则。新的正确性报错要修。
3.5 验证：`npm run lint` 退出码 0。

### Step 4 — CI workflow

4.1 新增 `.github/workflows/ci.yml`：push / pull_request 触发；Node 20；`npm ci`；跑 `npm run typecheck`、`npm run lint`、`npm run build`。**无部署 step**（部署日另行处理）。
4.2 注意 `npm ci` 需要 package-lock.json 与 package.json 同步（Step 3 安装后需提交更新的 lock 文件）。
4.3 验证：本地依序跑三个命令全部通过；yaml 语法检查通过（可用 node yaml 解析或人工核验缩进）。

### Step 5 — `src/lib/github.ts` → `src/lib/juya.ts`

5.1 `git mv src/lib/github.ts src/lib/juya.ts`。
5.2 更新 `src/app/page.tsx`、`src/components/DailyPage.tsx` 的 import 路径。
5.3 文件头注释改为：数据源说明保留 + 追加一行「部署日（ADR-0013）首页将迁移到 /api/daily/:date，届时本文件的 fetch 链路下沉 Worker，前端仅保留渲染」。
5.4 **禁止**：删除 fetchDailyList / fetchDailyContent、改变任何函数签名或行为、顺手重构 parseMarkdown（那是 spec 01 的事）。
5.5 验证：`npm run typecheck` 0 错；`grep -rn "lib/github" src/` 零命中；`npm run build` 成功；`npm run dev` 启动后首页正常加载（curl 首页 HTML 有骨架/内容标记即可，完整交互核对留待 spec 04）。

## 验收清单（全绿即 spec 完成）

- [ ] `grep -rn "site-badge\|botanical" src/` 零命中
- [ ] `npm run typecheck` 退出码 0
- [ ] `npm run lint` 退出码 0
- [ ] `npm run build` 成功产出 `out/`
- [ ] `.github/workflows/ci.yml` 存在且包含 typecheck + lint + build 三步、无部署步骤
- [ ] `src/lib/github.ts` 不存在；`src/lib/juya.ts` 存在；引用更新完毕
- [ ] 首页 dev 加载正常（行为未变）

## 边界

- 不引入 Vitest（spec 01 的事）。
- 不动 `worker/`、`data/`、`docs/`（除本 spec 引用外）。
- 不改 README（上一轮已对齐）。
- 不做任何视觉重设计（spec 04 按 FRONTEND_DESIGN.md 执行）。

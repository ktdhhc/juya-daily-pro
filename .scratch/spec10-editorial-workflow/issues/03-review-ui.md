# 03 · 审核页前端：/review + Header「审核」入口 + FRONTEND_DESIGN §4.9

Status: ready-for-agent

## What to build

按 `docs/spec/spec10-editorial-workflow.md` Step 3（3.1→3.3）执行。契约以 spec「契约（钉死）」节「前端」小节与「解析与审核 API」节为准。前置：spec07（AdminGate/isAdmin/apiFetch 附头）、spec10-02（四端点可用）。

### 3.1 页面与组件族

- `src/app/review/page.tsx`（"use client"）：挂载时 `isAdmin()` → `apiFetch("/api/review/pending")`；访客 → §4.6 空态 + `<AdminGate onVerified={...}>` 原地解锁；空暂存 → 「暂无待审内容」空态（§4.6 竖排短语风格）。
- `src/components/review/StagedIssueList.tsx`：期卡片（日期 + 条目列表）；条目行 = 现归属徽章（`owner-badge` 既有形态，无 role 的灰显）+ proposal 建议徽章（role 徽章主次：primary 强调、partner/subject 弱化——配色只用既有变量）+ 编辑控件。
- `src/components/review/ProposalEditor.tsx`：单条目编辑——每个归属行：公司名 + role select（primary/partner/subject/移除）+「新增归属」（从 /api/companies 索引搜选）；变更即调 `PATCH /api/review/item`（乐观 UI 或行内 loading 态，失败回滚 + 行内错误提示）；约束：primary ≤1（前端先拦，服务端兜底）。
- `src/components/review/CandidatePanel.tsx`：候选公司列表（id/name/aliases/reason/source_item_id + confidence）+ 每条操作：「复制 YAML」（剪贴板输出 companies.yaml 追加片段，规范单引号）+「标记已入册」/「忽略」（调 PATCH？——**不需要**：这两个动作本票只做视觉禁用+tooltip「待 spec10-04」，除非 spec10-02 已提供候选状态端点——**以 spec10-02 实际交付为准：没有则 UI 只读展示+复制YAML**）。
- `src/components/review/PublishBar.tsx`：底部固定条（sticky）：期勾选（默认全选）+「确认入库」→ `POST /api/review/publish { dates }` → 成功后重拉 pending（已发布期消失）+ 细线成功小条（复用 Header 同步反馈语言）。
- `src/lib/api.ts`：新增四个调用封装（fetchPendingReview / patchReviewItem / publishReview / triggerParse——POST /api/parse 给「解析」按钮用；类型按 spec10-02 实际响应形状对齐，允许在 api.ts 增 interface）。

### 3.2 Header 入口与解析按钮

- `src/components/Header.tsx`：管理员态新增「审核」文字链（与「管理/退出管理」同区域同字号）；待审期数 >0 → 「审核·N」（N 来自挂载时一次 fetchPendingReview 计数，管理员态才查）；/review active 态处理（HeaderActive 加 "review"）。
- /review 页内放「运行解析」按钮（icon-btn 或文字链，POST /api/parse；运行中 aria-busy；完成后重拉 pending 并显示 processed/candidatesFound 摘要小条）——审核流程动线：进页 → 解析 → 检查/编辑 → 确认入库。

### 3.3 FRONTEND_DESIGN §4.9

追加「§4.9 审核工作流」：待审（朱橙点标）/已决（墨）视觉语言、徽章主次（primary 强调色、partner/subject 弱化）、编辑控件用既有 select/文字链语言（禁通用组件）、发布确认的反馈形态。风格与现文一致。

## 红线

- 禁止 git commit / git add。
- 只允许改动：`src/app/review/`（新建）、`src/components/review/`（新建）、`src/components/Header.tsx`、`src/lib/api.ts`、`docs/FRONTEND_DESIGN.md`（仅 §4.9）。其他文件不碰。
- 不新增依赖；配色只用既有 CSS 变量；TS strict；中文注释。
- 服务端响应形状以 spec10-02 实际交付为准（读 worker/api/parse.ts 的类型与 routes 实现），发现契约漂移**不要自己改 worker**——汇报差异由主会话裁决。

## Acceptance criteria

- [ ] `npx tsc --noEmit` 绿；`npx eslint src/app/review src/components/review src/lib/api.ts` 0 error
- [ ] `npm run build` 45→46 页（+review 壳）
- [ ] 自述：动线说明（访客解锁/解析/编辑/发布）+ 契约差异清单（若有）
- [ ] 浏览器全流程走查由主会话执行（编辑生效/发布可见/访客不可见）

## Blocked by

.spec10-editorial-workflow/issues/02-parse-review-api.md
.spec07-role-baseline/issues/02-frontend-admin-role.md（已交付）

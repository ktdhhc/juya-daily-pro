# Review · spec11 反馈第二轮（2026-08-30，主会话实现 + 主会话验收）

**结论：PASS**（实现方式偏离原计划：agent 通道全面故障——quota/model failed 连续 6 次——两票由主会话按票面 TDD 亲自实现；红→绿证据齐备）

## 交付与验收证据

- **A. stagedDates 权威口径**（契约 A）：批尾查 `published=0`；实测重同步 `dates:4, stagedDates:[]`——「同步 N 期（待审核）」误报根除；前端文案分支 stagedDates 非空才报待审。
- **B. 已发布重解析通道**（契约 B）：`buildPublishedMissingRolesQuery`（published=1 + 多家命中 + 无 enrich_cache + role 含 NULL）并入圈题；**已发布条目的 proposal 立即应用**（无后续 publish 节点）。实测演练两轮：
  - 第一轮 0 条被圈 → 暴露两处设计误判并修正（有 proposal 的已发布条目恰是待补救形态，不得排除；proposal 幂等跳过只约束暂存类）——这正是票面红线之外必须实测的原因
  - 第二轮 `processed:1`，20260829-6 role 即时生效（openai=primary/google=subject），enrich_cache 回写不再重圈
- **C. suggest 端点**（契约 C）：`buildSuggestQuery`（title 命中优先 + ESCAPE 转义）+ `summarizeMatch`（前后 40 字片段）；实测命中 8 行/无命中空/注入转义 200。
- **D. 热力图修订**（契约 D）：档位改 0..3（0 条/无记录=8% 中性同色、1-9=35%、10-19=60%、≥20=100%）；84 格全渲染，实测 71 个无记录格带「无同步记录」tooltip；chartMath 22 用例红→绿。
- **E. 阅读时间线**（§4.10）：TimelineRail 自省 `h2[id^='article-']`（无需上层传数据）；8 刻度与当期 8 条对齐、tooltip 24 字截断正确；点击 handler 实测触发（补丁日志证明 scrollTo 以正确参数调用）；scrollspy 判定逻辑仿真正确（滚至 #5 → active=5）。
- **F. 搜索联想与高亮**（§4.11）：联想下拉实测 8 行/22 处 mark/Enter 选中跳转、行点击 → `/?date=2026-08-30#article-1`；/stream 结果页 27 处 mark。

## 过程发现（已修）

- **P1（既有 bug 被高亮暴露）**：`loadFirst` 不回写 facets 状态——首屏从 URL 起的 query 不进 `facets.query`，筛选 chip 缺失（既有）+ 高亮失效（新功能）。修复：loadFirst 开头 `setFacets(f)`。
- **P2（配置）**：wrangler.jsonc `LLM_API_BASE`/`LLM_MODEL` 过期占位（api.openai.com/gpt-4o-mini）与实际 DeepSeek key 不匹配——0830 解析 401 的最终根因（worker 打错端点）。已从 .env 程序化同步真实值；**部署日 wrangler.jsonc vars 随代码走，无需再改**。
- **P3（环境认知）**：IAB 遮挡态不产渲染帧 → rAF 不触发 → smooth 滚动与 rAF 节流 scrollspy 在自动化验证中不可观测（spec07 P1「smooth 被吞」同根因）。真实浏览器不受影响；scrollspy 判定逻辑以仿真验证。

## 门禁

tsc 0 / eslint 0 error（7 既有范式 warn）/ vitest 292 全绿（chartMath 22 + suggest 9 + parse 34 + HighlightText 4 新增）/ build 46 页。

## 无后续票

热力图「无记录格与 0 条格同色」为契约既定（深浅只随条数）；时间线仅 lg+ 为重叠规避的工程决策（§4.10 已记）。

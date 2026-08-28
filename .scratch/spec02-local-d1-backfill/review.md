# Spec 02 Code Review · 2026-08-29

审查范围：schema.sql sources 增补、wrangler.jsonc（crons/secrets）、wrangler 4.127.1、archive.ts、sqlgen.ts、registry 生成链（gen-registry → registry.generated.ts）、backfill.ts。审查人：主会话（backfill.ts 与 sqlgen.ts 逐行读，archive.ts 全读，四门禁 + D1 counts 独立复跑）。

## 结论：PASS（无 P0 / 无 P1；1 项 P1 在实现期发现并已修复）

## 验收核验（主会话独立复跑）

- [x] `npm test` 52/52（spec01 16 + archive 5 + sqlgen 15 + gen-registry 10 + registry 6）
- [x] `npm run typecheck` 0 错；`npm run lint` 0 error；`npm run build` 成功
- [x] D1 counts：**sources 72 / items 1105 / companies 30 / item_companies 0**（72 == archive 期数）
- [x] 抽样：20260827-1 = GLM-5.3-Flash / 要闻 / 1 ✓
- [x] 幂等：agent 两轮回填 counts 逐字一致
- [x] wrangler.jsonc：crons `[]` + 注释保留；`secrets` 对象形态；零登录（无 --remote/login 痕迹）

## 实现期发现并修复的 P1

1. **wrangler.jsonc `secrets: ["LLM_API_KEY"]` 为非法形态**（Cloudflare 2026-03-24 起 secrets 声明要求对象形态，wrangler ≥4.69 硬拒绝配置解析）。处置：改为 `"secrets": { "required": ["LLM_API_KEY"] }` 并将 wrangler 从临时锁定的 4.68.1 升级至 4.127.1，全部命令复验通过。教训入册：上游 ADR/PRD 写于该特性引入之前，配置字段随平台演进需要校验。

## 实现质量要点

- sqlgen.ts：单引号翻倍 + `\0` 剥离正确（SQLite 无反斜杠转义，反斜杠原样保留是对的）；primary_link undefined → 裸 NULL；related_links/aliases 走 JSON 字符串；ON CONFLICT 覆盖全部非键列——与 ADR-0008/0013 幂等要求逐字对齐。
- backfill.ts：ARCHIVE_URL/MD_BASE 从 wrangler.jsonc vars 读取（ADR-0006 env 驱动原则延伸到本地脚本）；并发池保序；失败重试 + 失败清单 + 退出码语义正确；wrangler 调用优先 node 直跑 bin 规避 Windows shell 转义；--json 解析对横幅行容错；整文件失败降级逐期分块；临时文件双路径清理。
- 行为证据链完整：72/72 抓取成功、145 条语句单文件执行、二次运行幂等、抽样字段正确、中途源站 6 分钟瞬断被正确识别为外部故障并重试成功。

## 分级发现

### P0 / P1（未决）

无（P1 secrets 已在实现期修复）。

### P2

无。

### P3（观察项）

1. 并发任务向 failures 数组 push 的顺序不确定——仅影响失败清单的打印顺序，不影响正确性。
2. backfill 摘要不显式断言 `sources == archive 期数`（当前通过"失败即退出码 1"传递保证；spec 05 的 sync 将有正式对账）。
3. `escapeSqlText` 不处理字符串内 `;`——wrangler/miniflare 的 SQL 拆分是引号感知的，且 145 条真实语句执行成功，风险仅存在于假想的非引号感知拆分器。
4. `_cf_METADATA` 为 D1 本地库内置表，出现在 sqlite_master 查询中属正常，不算第七张用户表。

## 流程观察

- 并行波次（票 01 wrangler/建表 ∥ 票 02 纯函数 TDD）无文件冲突，隔离约束（02 不碰 package.json）执行到位。
- 测试侧两处红（断言写错、ES2017 不支持 dotAll 标志）都发生在测试代码而非实现——红→绿纪律把错误挡在了测试侧。

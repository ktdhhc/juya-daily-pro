# Spec 03 Code Review · 2026-08-29

审查范围：matchCompanies.test.ts（14 用例）、sqlgen 扩展（itemCompaniesUpsertSql / enrichStateUpdateSql + 9 用例）、worker/sync/match.ts（matchAll + 3 用例）、scripts/lib/wrangler-cli.ts 抽取、scripts/match-all.ts。审查人：主会话（match.ts 逐行读，match-all 结构核对，四门禁 + D1 查询独立复跑）。

## 结论：PASS（无 P0 / 无 P1）

## 验收核验（主会话独立复跑）

- [x] `npm test` 78/78（52 + 26）
- [x] typecheck 0 错 / lint 0 error（5 处既有 warn）/ build 成功
- [x] enrich_state 分布：ok 863 + missing_owner 242 = 1105 ✓
- [x] item_companies：1222 行、distinct 对 1222（无重复）、**role 非空 = 0**（ADR-0014 ✓）
- [x] 幂等：agent 两轮 match:all 计数逐字一致
- [x] 抽样：20260828-6 → anthropic 行 role null；20260828-5 四家并列全 null
- [x] 零 LLM、零登录

## 实现质量要点

- match.ts 极简纯编排（33 行）：Pick<Item,...> 入参类型与 matchCompanies 既有风格一致，聚合结构直接对齐 SQL 生成所需——无多余抽象。
- 变异验证（mutation check）：matchCompanies 测试首轮即绿（实现本来就对），agent 临时破坏 escapeRegExp 证明测试真实咬合（2 个用例失败）后逐字节还原——这是对"绿测不咬合"风险的标准处理，值得成为后续 spec 的惯例。
- sqlgen 两新函数延续 expectDiscipline 纪律；role 以裸 NULL 进 VALUES、ON CONFLICT DO UPDATE SET role = excluded.role 保持幂等。
- wrangler-cli 抽取后 backfill.ts 仅改 import（行为不变），match-all 复用同一执行/解析路径。

## 分级发现

### P0 / P1 / P2

无。

### P3（观察项）

1. `matchAll` 对 1105 条 Item 每条重新编译 30 家公司的 alias 正则（O(items × companies)）——当前 <1s 无感；若未来 registry 上千家公司可把 compileAliases 提到循环外（matchCandidates 的参数形态已允许，届时再动）。
2. enrichStateUpdateSql 用 `UPDATE ... WHERE id IN (<字面量列表>)`——863 个 id 的单语句在本地 D1 无压力；若未来分块阈值需要，sqlgen 层加 chunk 即可。
3. 命中分布（0 家 22%、≥2 家 23%）符合"白名单闸门偏严"的预期画像，无异常信号。

## 流程观察

- 红→绿三段各有真实红态证据（Cannot find module ×2、is not a function ×9）；测试侧两处笔误在绿前修正，无造假。
- agent 对 spec 与实现的四处微偏差（Pick 类型、SET 空格等）均主动报告并给出理由，边界纪律良好。

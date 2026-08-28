# Spec 01 Code Review · 2026-08-29

审查范围：`worker/sync/parse.ts`（225 行）、`worker/sync/parse.test.ts`（616 行）、vitest 基建。审查人：主会话（parse.ts 逐行读，测试清单逐条核对，四门禁独立复跑）。

## 结论：PASS（无 P0 / 无 P1，无需追加修复票）

## 验收核验（主会话独立复跑）

- [x] `npm test` 16/16 全绿（快照 4 + 边界 12，与票面清单一致）
- [x] fixture 计数断言：2026-08-27 = 19、2026-08-25 = 14（写死于快照测试）
- [x] `npm run typecheck` 0 错；`npm run lint` 0 error（5 处既有 warn 不变）；`npm run build` 成功
- [x] `src/` 零改动（git diff --stat 核验）；`src/lib/juya.ts` 未动
- [x] parse.ts 纯函数（import 仅 schema type；无 fetch/fs/process/CF API）
- [x] 红→绿过程有证据（Cannot find module './parse' → 16/16）

## 实现质量要点（逐行读结论）

- 区域划分正确：概览区以 `---` 或下一 `## ` 兜底退出（覆盖"无 ---"变体）；文末提示尾行非 `### ` 行天然不产出 Item；`## 概览` 不作为分类。
- id 分配确定性与防冲突：tagged id 用 Set 查重，重复 `#N` 与无编号条目共用一个按文档序递增的 `-x<k>` 计数器；`-x<k>` 与 `-\d+` 形态不可能碰撞（tag 正则限 `\d+`）。
- 外层循环与 scanItem 的边界衔接正确（`end` 指向边界行，`i = end - 1` 回退后由主循环处理边界行）。
- enrichState 只产 `ok | pending`，`missing_owner` 留给 spec 03——与 ADR-0008 分工一致。
- 相关链接块支持全角/半角冒号、`- [x](url)` 与裸 `- url`、块内空行续列——比 spec 最低要求更完备，均有测试。

## 分级发现

### P0 / P1

无。

### P2

1. **spec 未定义"无编号条目"与"重复 #N"共存时 fallback 计数如何分配**——实现固化为共用一个按文档序递增的计数器（合理且确定性），已在 parse.ts:114 注释。→ spec 视为已被实现决策补全，无需改代码；未来若 ADR-0002 修订 id 规则再对齐。

### P3（观察项）

1. 标题正则 `(.+?)\]\(` 非贪婪，标题含 `](` 字面量时会截断——真实日报不出现此形态，快照测试会在结构漂移时报警，接受。
2. 缺 `>` 行时 bodyMd 自条目头后开始（spec 未定义，实现取合理解释，有测试固化）。
3. `#N` 必须带反引号才被识别（`#N` 裸写不识别）——fixtures 全部带反引号，真实形态一致，接受。
4. vitest inline 快照（4 枚）随测试文件入库——diff 可读性好，符合 ADR-0011"快照 diff 即 CI 报警"的意图。

## 流程观察

- spec 2.2 的 12 条规则在实现中全部有对应测试；agent 在规则未覆盖处（P2/P3.2）选择固化解释并报告而非擅自扩权，TDD 纪律执行到位。

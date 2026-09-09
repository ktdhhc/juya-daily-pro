# 01: 无主导判定（LLM 出口 → 不硬选主导）

**What to build:** 解析段能判定"候选清单里没有主角"——对这类条目不再硬选一个候选当主导；该条目不产生归属建议、归属角色全部留空，照常入库。验收者能看到：一条主角不在白名单的条目跑完解析后，没有归属建议、事件流里也没有错误的主导徽章。

**Blocked by:** None (can start immediately)

**Status:** done（验收证据见 ../review.md「验收证据」）

- [x] 主导判定 prompt 明确包含规则：条目主体公司不在候选清单时 `primary_company_id` 返回 `null`（纯函数断言 prompt 文本包含该规则）
- [x] 响应解析可区分两条路径并各有测试：合法无主导（primary 为 null + 非空 reason）→ 返回无主导裁决；响应不合法（非法 JSON / 幻觉 id / 缺 reason）→ 返回解析失败
- [x] 解析执行体在无主导裁决下不写归属建议，条目保留段一命中的归属行且角色全空
- [x] 集成验收（`wrangler dev --test-scheduled` + 读 D1）：构造一条会判无主导的暂存条目，跑完解析后该条目无归属建议、published 照常翻 1（自动入库不因缺主导挂起）
- [x] 既有测试套件零回归（typecheck 通过）

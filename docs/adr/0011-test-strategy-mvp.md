# 测试策略：MVP 仅测纯函数

## Decision

MVP 阶段只测下游入口的纯函数：

- `parseMarkdown` —— 抽样真实日报 md 做快照测试、对边界 case（无主链接、缺 #N、缺 > 摘要、缺相关链接块）断言
- `matchCompanies` —— 白名单 alias 命中、正则/字面量混合、同公司多别名去重、retired 公司不命中
- `enrichLLM` 的 prompt 组装（不测真实 LLM，只测 prompt 拼接）
- 启发式 role 补全（title 里"与/和"连接 → partner、仅 body 提及 → subject）

形式：Vitest。

不测：Worker fetch 入口、D1 SQL、前端组件、E2E。

## Why

最易出错的两处是手写正则解析与别名匹配，且都是纯函数可独立测。Worker 与 D1 在 dev 阶段通过手动验证、生产通过读 API 响应验证。前端组件与主题切换体感靠人工 review，写测试得不偿失。

## Consequences

- CI 需加 `npm test` 步骤
- 抽样日报 md 做快照后，日报结构异常变化会在 CI 立即报警（snapshot diff 醒目）
- LLM 真实调用不测——成本高且不稳定，依赖手工 review enrich_cache
- Worker fetch / D1 SQL 出错只能靠运行时发现
- 二期若加 RAG 视图需要新增对应纯函数测试
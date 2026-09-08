# 01: 同步核心抽取（预重构）

**What to build:** 把 HTTP 同步端点的主体抽成可复用的同步核心函数，返回结构化摘要（写入期、新增/更新/未变化三分类、暂存计数、失败清单、耗时），HTTP 路由变成薄壳。用户视角：手动同步与即将到来的定时任务行为完全一致，前端与既有调用方零感知。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] 同步核心函数导出，内部完成运行记录落库；HTTP 路由调用它并保持响应逐字段不变
- [x] 既有 `npx vitest run worker/` 全部用例零回归（210+）
- [x] curl 实测响应与改动前同形（dates/stagedDates/stagedItems/added/updated/unchanged/failures）
- [x] 不新增依赖；`npx tsc --noEmit -p worker` 与根 tsc 绿

## Comments

2026-09-08 交付：`runSyncCore(env): Promise<SyncSummary>` 抽取，HTTP 薄壳响应逐字节不变（主会话 curl diff 空）；worker 222 用例零回归；双 tsc 绿。

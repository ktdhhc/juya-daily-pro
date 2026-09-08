# 04: 运维脚本远端目标支持

**What to build:** 给运维脚本加远端数据库目标：新增纯函数解析命令行目标（本地/远端，缺省本地），五个脚本统一透传。用户视角：部署日可以一条命令把数据回填进生产库，而本地零登录的开发流程完全不变。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] 命令行目标解析纯函数 TDD 红→绿（缺省本地 / 显式远端 / 混入其他参数）
- [x] 五个运维脚本透传该目标；缺省行为不回归（贴一条既有命令输出）
- [x] `--remote` 透传证据（未登录时报远端鉴权/网络类错误即算通过，不要求真连远端）
- [x] `npx vitest run` 全量绿；根 `npx tsc --noEmit` 绿

## Comments

2026-09-08 交付：`parseDbTarget` 4 例红→绿（含参数混排）；5 脚本 13 处调用点透传；缺省 `match:all` 本地不回归；`sync -- --remote` 鉴权错误取证；全量 373 用例绿。

# 运行参数：环境变量驱动，可热改不改代码

> **修订 2026-08-28（ADR-0013 / 0014）**：cron 相关参数与 `LLM_*` / `R2_BUCKET` 推迟到部署日生效；v1 本地同步仍遵循本文 env 驱动原则（`ARCHIVE_URL` / `MD_BASE` / `SYNC_LOOKBACK_DAYS`）。env 驱动机制本身不变。

## Decision

cron Worker 与 sync 流程的可调参数全部走 Cloudflare Worker 环境变量（通过 `wrangler secret` / `wrangler.jsonc` `vars` 注入），便于不重新部署代码即可调整：

- `CRON_SCHEDULE`         cron 表达式（wrangler.jsonc 默认 `"0,30 0,1,2 * * *"`，即 UTC 00:00-03:00 半小时一次 = 北京时间 08:00-11:00；与 daily.juya.uk 早晨发布窗口对齐）。注意：Cloudflare cron 一旦在 wrangler.jsonc 声明即不可热改，调整需 redeploy
- `SYNC_LOOKBACK_DAYS`    幂等检查向后看的天数（默认 `3`），防 archive 单源漏期
- `ARCHIVE_URL`           daily.juya.uk archive 地址，默认 `https://daily.juya.uk/archive/`
- `MD_BASE`              markdown 基址，默认 `https://daily.juya.uk/markdown`
- `LLM_API_BASE`         OpenAI 兼容协议 base URL
- `LLM_API_KEY`          secret，不在 wrangler.jsonc 明文
- `LLM_MODEL`            模型 ID
- `MAX_LLM_PER_RUN`      单次解析运行的最大 LLM 调用数（默认 `20`），防止失控

> 2026-09-08（spec15 票 02）：`LLM_ENABLED` / `ENRICH_CACHE_ENABLED` / `R2_BUCKET` 三个参数全仓零消费者，已从 wrangler.jsonc 移除（R2 随 ADR-0013 裁剪，另两个开关从未接线）；此处保留条目仅作历史记录。

## Why

juya-daily 一开始频率不确定、LLM 提供方可能切、archive 域可能再变。环境变量让所有运维点单点可调、不需 redeploy。Cloudflare Workers 环境变量分两档：

- `vars`（明文，写 wrangler.jsonc，redeploy 改）
- `secrets`（密文，`wrangler secret put` 改，立即生效不动代码）

凡涉及密钥走 secrets，凡涉及可调参数走 vars。

## Cron 表达式注意

Cloudflare cron trigger **不支持运行时改 schedule**（不像`setInterval`），表达式在 wrangler.jsonc `triggers.crons` 声明，调整需 redeploy。所以频率参数的"热改"实际只覆盖除 cron 表达式以外的可调项。`CRON_SCHEDULE` 环境变量留作脚本自检展示用途，但真实生效靠 wrangler.jsonc redeploy。如果未来需要快速热改频率，可在 Worker 内自加"上次跑后间隔判断"软节流，跳过本次执行直至到达 N 分钟，可热改不需 redeploy。MVP 不做这层软节流。

## Why not the alternatives

- 代码硬编码：每次调频率或切换 LLM 提供方都要改代码 redeploy，运维重；与"未来要给其他用户查阅"的产品定位不符。
- 配置文件外置 + 拉取：Worker 不适合运行时拉远程配置文件，且 Cloudflare secrets/vars 已经是更原生的方式。

## Consequences

- `wrangler.jsonc` 必须声明所有 vars 默认值与 secrets 引用名
- `.dev.vars` 用于本地开发模拟，需进 `.gitignore`
- Worker 启动时需对缺失 env 做兜底（不抛错，掉到默认值）
- cron 表达式实际修改仍需 wrangler redeploy，但仅此一项需 redeploy
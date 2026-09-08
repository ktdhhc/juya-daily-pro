# 02: 部署配置就绪化

**What to build:** 清掉会让部署失败的残留配置，并把管理口令变成部署强制项。用户视角：部署命令不再被早已裁剪的存储绑定挡住；生产环境忘记配口令这件事变成不可能（部署即报错提示），而不是悄悄全开放。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] 移除已裁剪存储的绑定块与三个无人消费的变量（删除前 grep 复核零引用并留证据）
- [x] 管理口令加入部署必需密钥清单
- [x] `npx wrangler deploy --dry-run` 成功（证明部署不再被残留绑定挡住）
- [x] grep 证据：残留绑定与死变量清零；`npx tsc --noEmit -p worker` 绿

## Comments

2026-09-08 交付：R2 绑定与 3 死变量清零（grep 证据）；ADMIN_TOKEN 入 secrets.required（wrangler 源码级实证：首部署缺 secret 即失败）。审查发现首部署 secret 先有鸡先有蛋 → 部署清单改用 `wrangler deploy --secrets-file .prod.secrets`（已 gitignore），CURRENT_STATE 同步。

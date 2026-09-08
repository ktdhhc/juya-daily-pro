# 02: 部署配置就绪化

**What to build:** 清掉会让部署失败的残留配置，并把管理口令变成部署强制项。用户视角：部署命令不再被早已裁剪的存储绑定挡住；生产环境忘记配口令这件事变成不可能（部署即报错提示），而不是悄悄全开放。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 移除已裁剪存储的绑定块与三个无人消费的变量（删除前 grep 复核零引用并留证据）
- [ ] 管理口令加入部署必需密钥清单
- [ ] `npx wrangler deploy --dry-run` 成功（证明部署不再被残留绑定挡住）
- [ ] grep 证据：残留绑定与死变量清零；`npx tsc --noEmit -p worker` 绿

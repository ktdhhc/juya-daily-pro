# Review · spec07 角色权限基座（2026-08-29，主会话验收）

**结论：PASS**（P2 一项已当场处置，无 P0/P1）

## 验收证据

- requireAdmin 四分支单测红→绿（agent 汇报 + 主会话复跑 `npx vitest run` 全量 144 passed）
- wrangler dev 守卫实测（--var ADMIN_TOKEN:test-token）：ping 无头 403 / 错头 403 / 对头 200；POST /api/sync 无头 403；开放形态全通
- 浏览器四态走查（:3000，主会话实测）：
  1. 访客：管理按钮在、同步按钮 DOM 零渲染 ✓
  2. 错口令：「口令不匹配」alert 出现、输入保留、无同步按钮 ✓
  3. 正口令：升级管理员（退出管理出现、口令条收起、同步按钮出现）✓
  4. 管理员点同步 → worker 日志 `POST /api/sync 200 OK (5228ms)`（apiFetch 自动附头端到端）✓；退出管理 → localStorage token 清空、同步按钮即刻消失 ✓
- SYNC_TOKEN：worker/ src/ scripts/ grep 零命中（docs/ 历史文档残留按约保留）
- 四门禁：144 tests / tsc ×2 / eslint 0 error（12 documented warnings）/ build 44 页

## 发现

- **P2（已处置）**：wrangler 4.127 在 wrangler.jsonc 声明 `secrets` 块后，`.dev.vars` 中未列入 `secrets.required` 的键**不注入** worker env（源码 cli.js:257190 证实：仅 `key in result || requiredSecrets.includes(key)` 才生效）。spec07 1.4「.dev.vars 设 ADMIN_TOKEN 即守卫生效」的前提不成立（实测：设值后无头 ping 仍 200）。
  处置：本地守卫验证统一走 `npx wrangler dev --var ADMIN_TOKEN:xxx`（实测有效）；`.dev.vars` 注释已改写说明；部署日不受影响（`wrangler secret put` 是运行时 secret，机制不同）。
- **P3**：AdminGate 网络异常时复用「口令不匹配」文案（票面未定义网络失败文案）——语义略宽，个人工具可接受。
- **P3**：AdminGate 增加可选 `onClose` prop（票面单 prop 契约的合理偏离，Esc 收起必须回调 Header）。
- **观察项（不立项）**：走查日志出现 ping 403/200 各两次——为自动化点击超时后迟到派发所致；AdminGate 的 `checking` 态已防真实重复提交。

## 无后续票

P2 为环境事实而非代码缺陷，处置已落在 .dev.vars 注释与本文档；P3 均为文案/契约微偏，不值得开票。

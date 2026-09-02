// Worker entry（wrangler.jsonc main，spec04 A4 创建）。
// fetch → read API 路由分发（spec04「API 契约」5 端点）；路由实现见 worker/api/routes.ts。
// scheduled → spec05 Step 2 仅挂载 stub（ADR-0013：v1 手动同步 npm run sync，cron 不启用，
// wrangler.jsonc triggers.crons 维持 []——stub 不会被触发）；部署日接线 binding 版流水线并可测 --remote。
import { handleApiRequest, type Env } from "../api/routes";

export type { Env };

export default {
  // ctx（spec13 契约 B）：线程化到 handleApiRequest，POST /api/parse 借 waitUntil 异步续跑解析作业
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleApiRequest(request, env, ctx);
  },

  async scheduled(_controller: ScheduledController, _env: Env, _ctx: ExecutionContext): Promise<void> {
    throw new Error("scheduled sync 尚未接线：v1 本地走 npm run sync；部署日启用（ADR-0013）");
  },
};

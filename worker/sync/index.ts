// Worker entry（wrangler.jsonc main，spec04 A4 创建）。
// fetch → read API 路由分发（spec04「API 契约」5 端点）；路由实现见 worker/api/routes.ts。
// scheduled 同步任务（cron 抓取/enrich）按 ADR-0013 于部署日启用（wrangler.jsonc triggers.crons 现为空），
// 届时在此补 scheduled handler——本 spec 不实现。
import { handleApiRequest, type Env } from "../api/routes";

export type { Env };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleApiRequest(request, env);
  },
};

// Worker entry（wrangler.jsonc main，spec04 A4 创建）。
// fetch → read API 路由分发（spec04「API 契约」5 端点）；路由实现见 worker/api/routes.ts。
// scheduled → spec15 票 03 接线：同步核心（票 01 抽取，与手动端点同一实现，内部落 sync_runs）→
// 无失败且存在待解析目标时复用既有解析异步作业（ctx.waitUntil 续跑）；解析进行中（parseBusy 未陈旧）
// 或无待解析目标则跳过；任何异常只 console.error 不向上抛。不触发入库——publish 仍仅人工（ADR-0015）。
import { handleApiRequest, runSyncCore, type Env } from "../api/routes";
import { collectParseContext, readParseState, startParse } from "../api/parse";
import { parseBusy } from "../api/parse-state";

export type { Env };

export default {
  // ctx（spec13 契约 B）：线程化到 handleApiRequest，POST /api/parse 借 waitUntil 异步续跑解析作业
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleApiRequest(request, env, ctx);
  },

  // 定时任务（wrangler.jsonc triggers.crons：北京时间 08:00-10:30 每半点）。
  // 时序：同步 → 失败则止步（运行记录已落 sync_runs，可回看）→ 解析进行中则跳过 →
  // 圈题（纯读，无 LLM 调用）为空则跳过 → 启动解析异步作业（LLM 调用在 waitUntil 内，不阻塞触发）。
  // 异常一律吞掉：定时任务无 HTTP 调用方，抛出只会污染运行日志。
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    try {
      const summary = await runSyncCore(env);
      console.log(
        `[cron ${controller.cron}] 同步完成：写入 ${summary.dates.length} 期，暂存 ${summary.stagedItems} 条，失败 ${summary.failures.length} 期`
      );
      if (summary.failures.length > 0) {
        console.warn(
          `[cron ${controller.cron}] 存在失败期，跳过解析：${summary.failures.map((f) => f.date).join(", ")}`
        );
        return;
      }
      // 解析进行中（未陈旧）→ 跳过本轮解析（与 POST /api/parse 同一 parseBusy 守卫，spec13 契约 B）
      const prev = await readParseState(env);
      if (parseBusy(prev, new Date())) {
        console.log(`[cron ${controller.cron}] 解析作业进行中，跳过本轮解析`);
        return;
      }
      // 圈题（纯读，不调 LLM）：无待解析目标则跳过，不浪费 LLM 调用（spec15 user story 18）
      const context = await collectParseContext(env);
      if (context.totalTargets === 0) {
        console.log(`[cron ${controller.cron}] 无待解析目标，跳过解析`);
        return;
      }
      // 复用既有解析异步作业；不调用 reviewPublish——入库仍由人工在审核台确认（ADR-0015）
      const result = await startParse(env, ctx, context);
      console.log(
        `[cron ${controller.cron}] 解析作业 started=${result.started}，圈题 ${context.totalTargets} 条`
      );
    } catch (err) {
      console.error(`[cron ${controller.cron}] 定时任务异常（不向上抛）：`, err);
    }
  },
};

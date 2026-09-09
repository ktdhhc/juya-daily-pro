// Worker entry（wrangler.jsonc main，spec04 A4 创建）。
// fetch → read API 路由分发（spec04「API 契约」5 端点）；路由实现见 worker/api/routes.ts。
// scheduled → spec15 票 03 接线 + ADR-0016 自动入库：同步核心（票 01 抽取，与手动端点同一实现，
// 内部落 sync_runs）→ 无失败且本轮有暂存期时，解析（复用既有异步作业，但等它跑完拿终态）→
// 按终态自动入库本轮暂存期；解析进行中 / 同步失败 / 解析失败 / 整轮零成功一律留人工（异常路径）。
// 手动链路（POST /api/sync + /api/parse + /api/review/publish）语义不变：手动同步仍只写暂存。
import { handleApiRequest, runSyncCore, type Env } from "../api/routes";
import { autoPublishDates, collectParseContext, readParseState, reviewPublish, startParse } from "../api/parse";
import { parseBusy } from "../api/parse-state";

export type { Env };

export default {
  // ctx（spec13 契约 B）：线程化到 handleApiRequest，POST /api/parse 借 waitUntil 异步续跑解析作业
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleApiRequest(request, env, ctx);
  },

  // 定时任务（wrangler.jsonc triggers.crons：北京时间 08:00-10:30 每半点）。
  // 时序（ADR-0016）：同步 → 失败则止步（运行记录已落 sync_runs，可回看）→ 无暂存期则止步 →
  // 解析进行中则整轮跳过（异常）→ 圈题（纯读，无 LLM 调用）为空则直接入库 →
  // 否则启动解析并**等它跑完**（_ctx 不传 → 执行体同步 await，为的是拿到终态决定是否入库），
  // 终态 done 且非整轮零成功时入库本轮暂存期；其余终态留人工。
  // 异常一律吞掉：定时任务无 HTTP 调用方，抛出只会污染运行日志。
  async scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    try {
      const summary = await runSyncCore(env);
      console.log(
        `[cron ${controller.cron}] 同步完成：写入 ${summary.dates.length} 期，暂存 ${summary.stagedItems} 条，失败 ${summary.failures.length} 期`
      );
      if (summary.failures.length > 0) {
        console.warn(
          `[cron ${controller.cron}] 存在失败期，跳过解析与自动入库：${summary.failures.map((f) => f.date).join(", ")}`
        );
        return;
      }
      if (summary.stagedDates.length === 0) {
        console.log(`[cron ${controller.cron}] 无暂存期，无事可做`);
        return;
      }
      // 解析进行中（未陈旧）→ 整轮跳过：另一轮作业/人工操作在跑，属异常路径（ADR-0016）
      const prev = await readParseState(env);
      if (parseBusy(prev, new Date())) {
        console.warn(`[cron ${controller.cron}] 解析作业进行中，跳过本轮解析与自动入库`);
        return;
      }
      // 圈题（纯读，不调 LLM）：无待解析目标 → 直接入库本轮暂存期（spec15 user story 18 不浪费 LLM）
      const context = await collectParseContext(env);
      if (context.totalTargets === 0) {
        const published = await reviewPublish(env, { dates: summary.stagedDates });
        console.log(
          `[cron ${controller.cron}] 无待解析目标，自动入库 ${published.publishedDates.length} 期 / ${published.itemsPublished} 条`
        );
        return;
      }
      // 有目标：等解析跑完再决策（无 ctx → 执行体同步 await）
      const started = await startParse(env, undefined, context);
      if (!started.started) {
        console.warn(`[cron ${controller.cron}] 解析未能启动（busy），暂存留人工`);
        return;
      }
      const finalState = await readParseState(env);
      const dates = autoPublishDates(summary.stagedDates, {
        status: finalState.status,
        processed: finalState.processed,
        total: finalState.total,
      });
      if (dates.length === 0) {
        console.warn(
          `[cron ${controller.cron}] 解析终态 ${finalState.status}（成功 ${finalState.processed}/${finalState.total}），暂存留人工`
        );
        return;
      }
      const published = await reviewPublish(env, { dates });
      console.log(
        `[cron ${controller.cron}] 解析完成（${finalState.processed}/${finalState.total}），自动入库 ${published.publishedDates.join(", ")}（${published.itemsPublished} 条）`
      );
    } catch (err) {
      console.error(`[cron ${controller.cron}] 定时任务异常（不向上抛）：`, err);
    }
  },
};

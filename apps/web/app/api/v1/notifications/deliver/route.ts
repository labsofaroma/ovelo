import { z } from "zod";
import { notifyDeps } from "@/features/notifications/server/deps";
import {
  assertWorkerSecret,
  noStore,
  notifyRoute,
} from "@/features/notifications/server/http";
import { runWorker } from "@/features/notifications/server/worker";
import { logger } from "@/server/logger";
import { parse } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/v1/notifications/deliver `Authorization: Bearer <AROMA_NOTIFY_WORKER_SECRET>` {}:
 * one outbox run (QStash schedule or cron, every minute). With AROMA_NOTIFICATIONS=off it does
 * nothing. Logs counts only.
 */
export const POST = notifyRoute("v1/notifications/deliver", async (request) => {
  const deps = notifyDeps();
  assertWorkerSecret(deps, request.headers.get("authorization"));
  await parse(z.object({}), { maxBytes: 1_024 })(request);
  if (!deps.config().enabled)
    return Response.json({ paused: true }, { headers: noStore });
  const report = await runWorker(deps);
  logger.info(
    { route: "v1/notifications/deliver", ...report },
    "notify worker run",
  );
  return Response.json({ paused: false, ...report }, { headers: noStore });
});

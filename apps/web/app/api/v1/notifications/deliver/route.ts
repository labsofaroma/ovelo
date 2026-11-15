import { z } from "zod";
import { notifyDeps } from "@/features/notifications/server/deps";
import {
  assertWorkerSecret,
  noStore,
  notifyRoute,
} from "@/features/notifications/server/http";
import { runWorker } from "@/features/notifications/server/worker";
import { syncFeeShareLedger } from "@/features/creators/fee-share";
import { feeSettings } from "@/server/env.fees";
import { logger } from "@/server/logger";
import { parse } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/v1/notifications/deliver `Authorization: Bearer <OVELO_NOTIFY_WORKER_SECRET>` {}:
 * the M11 periodic worker (QStash schedule or cron, every minute): the fee-share ledger
 * (accounting only, always), then one notification outbox run (nothing with
 * OVELO_NOTIFICATIONS=off). Logs counts only.
 */
export const POST = notifyRoute("v1/notifications/deliver", async (request) => {
  const deps = notifyDeps();
  assertWorkerSecret(deps, request.headers.get("authorization"));
  await parse(z.object({}), { maxBytes: 1_024 })(request);
  const ledger = await syncFeeShareLedger(
    deps.db(),
    feeSettings(process.env),
    deps.now(),
  );
  if (!deps.config().enabled)
    return Response.json({ paused: true, ledger }, { headers: noStore });
  const report = await runWorker(deps);
  logger.info(
    { route: "v1/notifications/deliver", ledger, ...report },
    "notify worker run",
  );
  return Response.json(
    { paused: false, ledger, ...report },
    { headers: noStore },
  );
});

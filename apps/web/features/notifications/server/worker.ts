import "server-only";
import type { BetaChannel } from "../schema";
import type { NotificationChannel } from "./channels/types";
import { claimDue, fanOut, prune, settle, type NotifyDb } from "./outbox";
import { renderEvent } from "./render";
import { scanReceipts, type ScanDeps } from "./scan";

/**
 * One worker run (POST /api/v1/notifications/deliver, from QStash or cron): scan receipts into
 * events, fan out, then deliver what is due. Each step is idempotent, so overlapping runs are
 * safe: SKIP LOCKED and the lease keep two runs off the same row. Logs carry ids and error codes
 * only, never a contact detail or message text.
 */
export type WorkerDeps = {
  db(): NotifyDb;
  channels(): Partial<Record<BetaChannel, NotificationChannel>>;
  scan(): Promise<ScanDeps>;
  site(): string;
  now(): Date;
};

export type WorkerReport = {
  scanned: number;
  fannedOut: number;
  sent: number;
  retried: number;
  dead: number;
};

export async function runWorker(
  deps: WorkerDeps,
  options: { batch?: number } = {},
): Promise<WorkerReport> {
  const db = deps.db();
  const now = deps.now();
  const scanned = await scanReceipts(db, await deps.scan(), now);
  const fannedOut = await fanOut(db, now);
  const report: WorkerReport = {
    scanned,
    fannedOut,
    sent: 0,
    retried: 0,
    dead: 0,
  };
  const channels = deps.channels();
  for (const claimed of await claimDue(db, now, options.batch ?? 50)) {
    const channel = channels[claimed.channel];
    const message = claimed.event
      ? renderEvent(claimed.event, deps.site())
      : null;
    const outcome =
      !message || !claimed.address
        ? await settle(
            db,
            claimed,
            {
              ok: false,
              retry: false,
              gone: false,
              code: !message ? "render" : "unsubscribed",
            },
            now,
          )
        : !channel
          ? await settle(
              db,
              claimed,
              { ok: false, retry: true, gone: false, code: "channel_off" },
              now,
            )
          : await settle(
              db,
              claimed,
              await channel.send({
                eventId: claimed.event!.id,
                channel: claimed.channel,
                message,
                address: claimed.address,
              }),
              deps.now(),
            );
    if (outcome === "sent") report.sent += 1;
    else if (outcome === "retry") report.retried += 1;
    else report.dead += 1;
  }
  await prune(db, now);
  return report;
}

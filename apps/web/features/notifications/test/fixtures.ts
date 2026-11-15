import { notificationSubscriptions } from "@/server/db/schema";
import type { NotifyDb } from "../server/outbox";

/** Test-only helpers. Addresses are fake and never leave the process. */
export async function activeSub(
  db: NotifyDb,
  wallet: string,
  channel: "push" | "telegram",
  events: string[],
  verifiedAt = new Date("2026-11-15T00:00:00Z"),
) {
  await db.insert(notificationSubscriptions).values({
    wallet,
    channel,
    status: "active",
    events,
    address: channel === "telegram" ? { chatId: 42 } : { subscription: {} },
    verifiedAt,
    createdAt: verifiedAt,
  });
}

export const T0 = new Date("2026-11-15T12:00:00Z");
export const at = (ms: number) => new Date(T0.getTime() + ms);

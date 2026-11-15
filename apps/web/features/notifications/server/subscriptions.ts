import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import {
  notificationEvents,
  notifications,
  notificationSubscriptions,
} from "@/server/db/schema";
import { AppError } from "@/server/errors";
import type {
  BetaChannel,
  NotifyEvent,
  PushSubscriptionJson,
  SubscriptionView,
} from "../schema";
import type { NotifyDb } from "./outbox";
import { recordEvent } from "./outbox";

/**
 * Subscriptions (one per wallet and channel). The contact detail is written only once it is
 * verified (the browser's own push subscription; the chat that sent the one-time code to the
 * bot) and is never returned by the API. Turning a channel off deletes the row and that
 * channel's deliveries; "delete all" also deletes the wallet's events (hard deletes).
 */
export const TELEGRAM_CODE_TTL_MS = 15 * 60_000;

const sha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

const view = (
  row: typeof notificationSubscriptions.$inferSelect,
): SubscriptionView => ({
  channel: row.channel as BetaChannel,
  status: row.status,
  events: row.events as SubscriptionView["events"],
  createdAt: row.createdAt.toISOString(),
  verifiedAt: row.verifiedAt?.toISOString() ?? null,
});

export async function listSubscriptions(
  db: NotifyDb,
  wallet: string,
): Promise<SubscriptionView[]> {
  const rows = await db
    .select()
    .from(notificationSubscriptions)
    .where(eq(notificationSubscriptions.wallet, wallet))
    .orderBy(notificationSubscriptions.channel);
  return rows.filter((r) => r.channel !== "email").map(view);
}

async function upsert(
  db: NotifyDb,
  values: typeof notificationSubscriptions.$inferInsert,
): Promise<SubscriptionView> {
  const { wallet, channel, ...rest } = values;
  const [row] = await db
    .insert(notificationSubscriptions)
    .values(values)
    .onConflictDoUpdate({
      target: [
        notificationSubscriptions.wallet,
        notificationSubscriptions.channel,
      ],
      set: rest,
    })
    .returning();
  if (!row || row.wallet !== wallet || row.channel !== channel)
    throw new AppError("INTERNAL", { detail: "subscription upsert" });
  return view(row);
}

/** Push: the browser's subscription is the verification (the user granted permission). */
export function subscribePush(
  db: NotifyDb,
  input: {
    wallet: string;
    events: NotifyEvent[];
    subscription: PushSubscriptionJson;
    now: Date;
  },
) {
  return upsert(db, {
    wallet: input.wallet,
    channel: "push",
    status: "active",
    events: input.events,
    address: { subscription: input.subscription },
    verifyCodeHash: null,
    verifyExpiresAt: null,
    createdAt: input.now,
    verifiedAt: input.now,
  });
}

/** Telegram: a pending row and a one-time code the user sends to the bot with /start. */
export async function startTelegram(
  db: NotifyDb,
  input: { wallet: string; events: NotifyEvent[]; now: Date },
): Promise<{ subscription: SubscriptionView; code: string }> {
  const code = randomBytes(24).toString("base64url");
  const subscription = await upsert(db, {
    wallet: input.wallet,
    channel: "telegram",
    status: "pending",
    events: input.events,
    address: null,
    verifyCodeHash: sha256(code),
    verifyExpiresAt: new Date(input.now.getTime() + TELEGRAM_CODE_TTL_MS),
    createdAt: input.now,
    verifiedAt: null,
  });
  return { subscription, code };
}

/** The bot received `/start <code>` from a chat: verify and store the chat id (single use). */
export async function verifyTelegram(
  db: NotifyDb,
  input: { code: string; chatId: number; now: Date },
): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(input.code)) return false;
  const rows = await db
    .update(notificationSubscriptions)
    .set({
      status: "active",
      address: { chatId: input.chatId },
      verifyCodeHash: null,
      verifyExpiresAt: null,
      verifiedAt: input.now,
    })
    .where(
      and(
        eq(notificationSubscriptions.verifyCodeHash, sha256(input.code)),
        eq(notificationSubscriptions.status, "pending"),
        gt(notificationSubscriptions.verifyExpiresAt, input.now),
      ),
    )
    .returning({ id: notificationSubscriptions.id });
  return rows.length > 0;
}

/** `/stop` in the bot: every subscription linked to that chat is deleted. */
export async function stopTelegramChat(
  db: NotifyDb,
  chatId: number,
): Promise<number> {
  const rows = await db
    .delete(notificationSubscriptions)
    .where(
      and(
        eq(notificationSubscriptions.channel, "telegram"),
        sql`${notificationSubscriptions.address}->>'chatId' = ${String(chatId)}`,
      ),
    )
    .returning({ wallet: notificationSubscriptions.wallet });
  for (const { wallet } of rows)
    await db
      .delete(notifications)
      .where(
        and(
          eq(notifications.wallet, wallet),
          eq(notifications.channel, "telegram"),
        ),
      );
  return rows.length;
}

export async function setEvents(
  db: NotifyDb,
  input: { wallet: string; channel: BetaChannel; events: NotifyEvent[] },
): Promise<SubscriptionView> {
  const [row] = await db
    .update(notificationSubscriptions)
    .set({ events: input.events })
    .where(
      and(
        eq(notificationSubscriptions.wallet, input.wallet),
        eq(notificationSubscriptions.channel, input.channel),
      ),
    )
    .returning();
  if (!row)
    throw new AppError("NOT_FOUND", {
      publicMessage: "This channel is not turned on.",
      detail: "preferences: no subscription",
    });
  return view(row);
}

/** Turn one channel off: the subscription (with its address) and its deliveries are deleted. */
export async function removeChannel(
  db: NotifyDb,
  wallet: string,
  channel: BetaChannel,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(notificationSubscriptions)
      .where(
        and(
          eq(notificationSubscriptions.wallet, wallet),
          eq(notificationSubscriptions.channel, channel),
        ),
      );
    await tx
      .delete(notifications)
      .where(
        and(
          eq(notifications.wallet, wallet),
          eq(notifications.channel, channel),
        ),
      );
  });
}

/** Delete everything notification-related for a wallet. */
export async function removeAll(db: NotifyDb, wallet: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(notificationSubscriptions)
      .where(eq(notificationSubscriptions.wallet, wallet));
    await tx.delete(notifications).where(eq(notifications.wallet, wallet));
    await tx
      .delete(notificationEvents)
      .where(eq(notificationEvents.wallet, wallet));
  });
}

/** Queue one test message to the wallet's own channel; at most one per channel per minute. */
export async function queueTest(
  db: NotifyDb,
  input: { wallet: string; channel: BetaChannel; now: Date },
): Promise<void> {
  const [sub] = await db
    .select({ status: notificationSubscriptions.status })
    .from(notificationSubscriptions)
    .where(
      and(
        eq(notificationSubscriptions.wallet, input.wallet),
        eq(notificationSubscriptions.channel, input.channel),
      ),
    );
  if (sub?.status !== "active")
    throw new AppError("CONFLICT", {
      publicMessage:
        "Turn this channel on and verify it before sending a test.",
      detail: "test: channel not active",
    });
  const minute = Math.floor(input.now.getTime() / 60_000);
  const fresh = await recordEvent(
    db,
    {
      id: `test:${input.channel}:${input.wallet}:${minute}`,
      wallet: input.wallet,
      kind: "test",
      cluster: "none",
      payload: { channel: input.channel },
    },
    input.now,
  );
  if (!fresh)
    throw new AppError("RATE_LIMITED", {
      publicMessage: "One test per channel per minute. Try again shortly.",
      detail: "test: same minute",
    });
}

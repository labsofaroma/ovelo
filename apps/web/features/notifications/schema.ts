import { z } from "zod";
import { base58Address as walletSchema } from "@/features/trade/schema";

/** Notification API contracts, shared by the route handlers and the client (one zod schema). */

/** Event kinds a wallet can receive. `test` is only ever sent to the wallet that asked for it. */
export const NOTIFY_EVENTS = [
  "trade_confirmed",
  "trade_failed",
  "trade_unconfirmed",
  "creator_basket_bought",
  "plan_round_executed",
  "plan_round_failed",
  "plan_low_balance",
] as const;
export type NotifyEvent = (typeof NOTIFY_EVENTS)[number] | "test";

/** Channels in this build. Email stays off: no email address is collected (M11 decision 1). */
export const BETA_CHANNELS = ["push", "telegram"] as const;
export type BetaChannel = (typeof BETA_CHANNELS)[number];

const nonce = z.string().regex(/^[A-Za-z0-9_-]{32}$/);
const signature = z.string().min(1).max(100);
const events = z
  .array(z.enum(NOTIFY_EVENTS))
  .min(1)
  .max(NOTIFY_EVENTS.length)
  .refine((list) => new Set(list).size === list.length, "duplicate event");

/** A browser PushSubscription as `toJSON()` returns it. The endpoint host is checked server-side. */
export const pushSubscriptionSchema = z.strictObject({
  endpoint: z.url({ protocol: /^https$/ }).max(1_024),
  expirationTime: z.number().nullable().optional(),
  keys: z.strictObject({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{16,32}$/),
  }),
});
export type PushSubscriptionJson = z.infer<typeof pushSubscriptionSchema>;

export const challengeBodySchema = z.discriminatedUnion("purpose", [
  z.strictObject({ purpose: z.literal("notify-manage"), wallet: walletSchema }),
  z.strictObject({
    purpose: z.literal("notify-subscribe"),
    wallet: walletSchema,
    channel: z.enum(BETA_CHANNELS),
    events,
    /** Push only: the browser subscription's endpoint, bound into the signed content. */
    endpoint: z
      .url({ protocol: /^https$/ })
      .max(1_024)
      .optional(),
  }),
]);

export const sessionBodySchema = z.strictObject({
  wallet: walletSchema,
  nonce,
  signature,
});

export const subscribeBodySchema = z.strictObject({
  wallet: walletSchema,
  nonce,
  signature,
  channel: z.enum(BETA_CHANNELS),
  events,
  push: pushSubscriptionSchema.optional(),
});

export const preferencesBodySchema = z.strictObject({
  channel: z.enum(BETA_CHANNELS),
  events,
});

export const testBodySchema = z.strictObject({
  channel: z.enum(BETA_CHANNELS),
});

export const challengeResponseSchema = z.object({
  nonce: z.string(),
  message: z.string(),
  expiresAt: z.string(),
});

export const subscriptionViewSchema = z.object({
  channel: z.enum(BETA_CHANNELS),
  status: z.enum(["pending", "active"]),
  events: z.array(z.enum(NOTIFY_EVENTS)),
  createdAt: z.string(),
  verifiedAt: z.string().nullable(),
});
export type SubscriptionView = z.infer<typeof subscriptionViewSchema>;

export const sessionResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
  subscriptions: z.array(subscriptionViewSchema),
});

export const subscriptionsResponseSchema = z.object({
  subscriptions: z.array(subscriptionViewSchema),
});

export const subscribeResponseSchema = z.object({
  subscription: subscriptionViewSchema,
  /** Telegram only: open this link and press Start to verify (single use, 15 minutes). */
  telegramLink: z.string().nullable(),
  token: z.string(),
  expiresAt: z.string(),
});

export const configResponseSchema = z.object({
  enabled: z.boolean(),
  push: z.object({ publicKey: z.string() }).nullable(),
  telegram: z.object({ bot: z.string() }).nullable(),
});
export type NotifyConfigView = z.infer<typeof configResponseSchema>;

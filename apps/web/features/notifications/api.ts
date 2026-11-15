import { call, post } from "../compliance/api";
import {
  challengeResponseSchema,
  configResponseSchema,
  sessionResponseSchema,
  subscribeResponseSchema,
  subscriptionsResponseSchema,
  subscriptionViewSchema,
  type BetaChannel,
  type NotifyEvent,
  type PushSubscriptionJson,
} from "./schema";

/** Client fetchers for /api/v1/notifications/* (zod-parsed; errors carry `{ code, message }`). */
const withToken = (token: string, init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: {
    ...(init.headers as Record<string, string> | undefined),
    Authorization: `Bearer ${token}`,
  },
});
const del = (token: string) =>
  withToken(token, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });

type Events = Exclude<NotifyEvent, "test">[];

export const notifyApi = {
  config: () =>
    call("/api/v1/notifications/config", (b) => configResponseSchema.parse(b)),
  challenge: (
    body:
      | { purpose: "notify-manage"; wallet: string }
      | {
          purpose: "notify-subscribe";
          wallet: string;
          channel: BetaChannel;
          events: Events;
          endpoint?: string;
        },
  ) =>
    call(
      "/api/v1/notifications/challenge",
      (b) => challengeResponseSchema.parse(b),
      post(body),
    ),
  session: (body: { wallet: string; nonce: string; signature: string }) =>
    call(
      "/api/v1/notifications/session",
      (b) => sessionResponseSchema.parse(b),
      post(body),
    ),
  subscribe: (body: {
    wallet: string;
    nonce: string;
    signature: string;
    channel: BetaChannel;
    events: Events;
    push?: PushSubscriptionJson;
  }) =>
    call(
      "/api/v1/notifications/subscriptions",
      (b) => subscribeResponseSchema.parse(b),
      post(body),
    ),
  list: (token: string) =>
    call(
      "/api/v1/notifications/subscriptions",
      (b) => subscriptionsResponseSchema.parse(b),
      withToken(token),
    ),
  setEvents: (token: string, channel: BetaChannel, events: Events) =>
    call(
      `/api/v1/notifications/subscriptions/${channel}`,
      (b) =>
        subscriptionViewSchema.parse(
          (b as { subscription: unknown }).subscription,
        ),
      withToken(token, post({ channel, events })),
    ),
  test: (token: string, channel: BetaChannel) =>
    call(
      "/api/v1/notifications/test",
      (b) => b,
      withToken(token, post({ channel })),
    ),
  remove: (token: string, channel: BetaChannel) =>
    call(
      `/api/v1/notifications/subscriptions/${channel}`,
      (b) => b,
      del(token),
    ),
  removeAll: (token: string) =>
    call("/api/v1/notifications/subscriptions", (b) => b, del(token)),
};

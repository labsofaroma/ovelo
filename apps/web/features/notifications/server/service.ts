import "server-only";
import { AppError } from "@/server/errors";
import {
  issueWalletChallenge,
  verifyWalletChallenge,
} from "@/server/wallet-challenge";
import { openSession, sealSession } from "@/server/wallet-session";
import { eventLabel, settingsCopy } from "../copy";
import type { BetaChannel, NotifyEvent, PushSubscriptionJson } from "../schema";
import { allowedPushEndpoint } from "./channels/webpush";
import type { NotifyDeps } from "./deps";
import {
  listSubscriptions,
  queueTest,
  removeAll,
  removeChannel,
  setEvents,
  startTelegram,
  subscribePush,
} from "./subscriptions";

/**
 * Notification settings (M11 Step 1). Two wallet-signed steps, the rest on a 15-minute session:
 * - `notify-manage`: the wallet signs once to open its settings → a `ws1` session token;
 * - `notify-subscribe`: turning a channel on is its own signed opt-in, naming the channel, the
 *   events and (push) the endpoint, so the opt-in record cannot be moved to another address.
 * Reads, event choices, test sends and deletes then use the session (an HMAC bearer token).
 */
function assertOn(deps: NotifyDeps, channel?: BetaChannel) {
  const config = deps.config();
  if (!config.enabled)
    throw new AppError("SERVICE_UNAVAILABLE", {
      publicMessage: settingsCopy.disabled,
      detail: "notifications off",
    });
  if (channel && !config.sinkUrl && !config[channel])
    throw new AppError("SERVICE_UNAVAILABLE", {
      publicMessage:
        "This notification channel is not set up on this deployment.",
      detail: `channel ${channel} not configured`,
    });
}

const subscribeContent = (input: {
  channel: BetaChannel;
  events: NotifyEvent[];
  endpoint?: string | undefined;
}) => ({
  channel: input.channel,
  events: [...input.events].sort(),
  endpoint: input.endpoint ?? null,
});

const subscribeSummary = (input: {
  channel: BetaChannel;
  events: NotifyEvent[];
  endpoint?: string | undefined;
}) => [
  `Channel: ${settingsCopy.channel[input.channel]}`,
  ...[...input.events]
    .sort()
    .map((e) => `Event: ${eventLabel[e as keyof typeof eventLabel]}`),
  ...(input.endpoint ? [`Push service: ${new URL(input.endpoint).host}`] : []),
];

const MANAGE_SUMMARY = ["Notification settings for this wallet."];

export async function issueNotifyChallenge(
  deps: NotifyDeps,
  origin: string,
  body:
    | { purpose: "notify-manage"; wallet: string }
    | {
        purpose: "notify-subscribe";
        wallet: string;
        channel: BetaChannel;
        events: NotifyEvent[];
        endpoint?: string | undefined;
      },
) {
  if (body.purpose === "notify-manage") {
    assertOn(deps);
    return issueWalletChallenge(
      deps.challenges(),
      {
        origin,
        wallet: body.wallet,
        purpose: body.purpose,
        content: null,
        summary: MANAGE_SUMMARY,
      },
      deps.now().getTime(),
    );
  }
  assertOn(deps, body.channel);
  if (
    body.channel === "push" &&
    (!body.endpoint || !allowedPushEndpoint(body.endpoint))
  )
    throw new AppError("VALIDATION_FAILED", {
      publicMessage: "This browser's push service is not supported.",
      detail: "push endpoint not allowed",
    });
  return issueWalletChallenge(
    deps.challenges(),
    {
      origin,
      wallet: body.wallet,
      purpose: body.purpose,
      content: subscribeContent(body),
      summary: subscribeSummary(body),
    },
    deps.now().getTime(),
  );
}

export async function openNotifySession(
  deps: NotifyDeps,
  origin: string,
  body: { wallet: string; nonce: string; signature: string },
) {
  assertOn(deps);
  const now = deps.now();
  await verifyWalletChallenge(
    deps.challenges(),
    {
      origin,
      ...body,
      purpose: "notify-manage",
      content: null,
      summary: MANAGE_SUMMARY,
    },
    now.getTime(),
  );
  return {
    ...sealSession("notify", body.wallet, { now: now.getTime() }),
    subscriptions: await listSubscriptions(deps.db(), body.wallet),
  };
}

export async function subscribe(
  deps: NotifyDeps,
  origin: string,
  body: {
    wallet: string;
    nonce: string;
    signature: string;
    channel: BetaChannel;
    events: NotifyEvent[];
    push?: PushSubscriptionJson | undefined;
  },
) {
  assertOn(deps, body.channel);
  const endpoint = body.channel === "push" ? body.push?.endpoint : undefined;
  if (
    body.channel === "push" &&
    (!body.push || !allowedPushEndpoint(body.push.endpoint))
  )
    throw new AppError("VALIDATION_FAILED", {
      publicMessage: "This browser's push service is not supported.",
      detail: "push subscription missing or not allowed",
    });
  const now = deps.now();
  const signed = { channel: body.channel, events: body.events, endpoint };
  await verifyWalletChallenge(
    deps.challenges(),
    {
      origin,
      wallet: body.wallet,
      nonce: body.nonce,
      signature: body.signature,
      purpose: "notify-subscribe",
      content: subscribeContent(signed),
      summary: subscribeSummary(signed),
    },
    now.getTime(),
  );
  const db = deps.db();
  const session = sealSession("notify", body.wallet, { now: now.getTime() });
  if (body.channel === "push") {
    const subscription = await subscribePush(db, {
      wallet: body.wallet,
      events: body.events,
      subscription: body.push!,
      now,
    });
    return { subscription, telegramLink: null, ...session };
  }
  const { subscription, code } = await startTelegram(db, {
    wallet: body.wallet,
    events: body.events,
    now,
  });
  const bot = deps.config().telegram?.bot ?? "ovelo_test_bot";
  return {
    subscription,
    telegramLink: `https://t.me/${bot}?start=${code}`,
    ...session,
  };
}

/** The wallet behind a notify session bearer token. */
export const sessionWallet = (deps: NotifyDeps, request: Request) =>
  openSession("notify", request.headers.get("authorization"), {
    now: deps.now().getTime(),
  });

export async function mySubscriptions(deps: NotifyDeps, wallet: string) {
  return { subscriptions: await listSubscriptions(deps.db(), wallet) };
}

export async function updateEvents(
  deps: NotifyDeps,
  wallet: string,
  body: { channel: BetaChannel; events: NotifyEvent[] },
) {
  return { subscription: await setEvents(deps.db(), { wallet, ...body }) };
}

export async function sendTest(
  deps: NotifyDeps,
  wallet: string,
  channel: BetaChannel,
) {
  assertOn(deps, channel);
  await queueTest(deps.db(), { wallet, channel, now: deps.now() });
  return { queued: true as const };
}

export async function deleteChannel(
  deps: NotifyDeps,
  wallet: string,
  channel: BetaChannel,
) {
  await removeChannel(deps.db(), wallet, channel);
  return { deleted: true as const };
}

export async function deleteAll(deps: NotifyDeps, wallet: string) {
  await removeAll(deps.db(), wallet);
  return { deleted: true as const };
}

import { z } from "zod";
import { subscribeBodySchema } from "@/features/notifications/schema";
import { notifyDeps } from "@/features/notifications/server/deps";
import {
  noStore,
  notifyOrigin,
  notifyRoute,
} from "@/features/notifications/server/http";
import {
  deleteAll,
  mySubscriptions,
  sessionWallet,
  subscribe,
} from "@/features/notifications/server/service";
import { assertSameOrigin, parse } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET (session): this wallet's channels and events. Never the contact details themselves. */
export const GET = notifyRoute(
  "v1/notifications/subscriptions",
  async (request) => {
    const deps = notifyDeps();
    const wallet = sessionWallet(deps, request);
    return Response.json(await mySubscriptions(deps, wallet), {
      headers: noStore,
    });
  },
);

/**
 * POST { wallet, nonce, signature, channel, events, push? }: the wallet-signed opt-in for one
 * channel. Push stores the browser subscription; Telegram returns a one-time bot link.
 */
export const POST = notifyRoute(
  "v1/notifications/subscriptions",
  async (request) => {
    const body = await parse(subscribeBodySchema, { maxBytes: 4_096 })(request);
    const result = await subscribe(notifyDeps(), notifyOrigin(request), body);
    return Response.json(result, { headers: noStore });
  },
);

/** DELETE (session) {}: delete every subscription, delivery and event of this wallet. */
export const DELETE = notifyRoute(
  "v1/notifications/subscriptions",
  async (request) => {
    assertSameOrigin(request);
    const deps = notifyDeps();
    const wallet = sessionWallet(deps, request);
    await parse(z.strictObject({}), { maxBytes: 256 })(request);
    return Response.json(await deleteAll(deps, wallet), { headers: noStore });
  },
);

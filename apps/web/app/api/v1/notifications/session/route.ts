import { sessionBodySchema } from "@/features/notifications/schema";
import { notifyDeps } from "@/features/notifications/server/deps";
import {
  noStore,
  notifyOrigin,
  notifyRoute,
} from "@/features/notifications/server/http";
import { openNotifySession } from "@/features/notifications/server/service";
import { parse } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/v1/notifications/session { wallet, nonce, signature } → a 15-minute `ws1` session
 * token and the wallet's subscriptions. Wallet-signed (`notify-manage`), single use.
 */
export const POST = notifyRoute("v1/notifications/session", async (request) => {
  const body = await parse(sessionBodySchema, { maxBytes: 2_048 })(request);
  const session = await openNotifySession(
    notifyDeps(),
    notifyOrigin(request),
    body,
  );
  return Response.json(session, { headers: noStore });
});

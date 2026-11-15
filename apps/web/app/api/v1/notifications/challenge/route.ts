import { challengeBodySchema } from "@/features/notifications/schema";
import { notifyDeps } from "@/features/notifications/server/deps";
import {
  noStore,
  notifyOrigin,
  notifyRoute,
} from "@/features/notifications/server/http";
import { issueNotifyChallenge } from "@/features/notifications/server/service";
import { parse } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/v1/notifications/challenge → `{ nonce, message, expiresAt }`. A 5-minute single-use
 * nonce for `notify-manage` (open settings) or `notify-subscribe` (turn a channel on). Issuing
 * changes no application state; it is in the tighter creator rate-limit bucket.
 */
export const POST = notifyRoute(
  "v1/notifications/challenge",
  async (request) => {
    const body = await parse(challengeBodySchema, { maxBytes: 2_048 })(request);
    const challenge = await issueNotifyChallenge(
      notifyDeps(),
      notifyOrigin(request),
      body,
    );
    return Response.json(challenge, { headers: noStore });
  },
);

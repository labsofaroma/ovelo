import { randomUUID } from "node:crypto";
import {
  creatorDeps,
  creatorRoute,
  expectedOrigin,
  noStore,
} from "@/features/creators/http";
import {
  challengeBodySchema,
  signedContent,
} from "@/features/creators/requests";
import { issueChallenge } from "@/server/auth/creator";
import { parse } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/v1/creators/challenge → `{ nonce, message, basketId, expiresAt }`.
 * The wallet signs `message`; the signed request then names `nonce`. Issuing changes no
 * application state (it stores a 5-minute single-use nonce), so it needs no signature itself.
 */
export const POST = creatorRoute(
  {
    route: "v1/creators/challenge",
    mutation: true,
  },
  async (request) => {
    const body = await parse(challengeBodySchema, { maxBytes: 16_384 })(
      request,
    );
    const deps = creatorDeps();
    const basketId =
      body.purpose === "redeem"
        ? null
        : body.purpose === "delete"
          ? body.basketId
          : (body.basketId ?? randomUUID());
    const { payload, message } = await issueChallenge(
      deps.challenges(),
      {
        origin: expectedOrigin(request),
        wallet: body.wallet,
        purpose: body.purpose,
        basketId,
        ...signedContent(body),
      },
      { now: deps.now().getTime() },
    );
    return Response.json(
      { nonce: payload.nonce, message, basketId, expiresAt: payload.expiresAt },
      { headers: noStore },
    );
  },
);

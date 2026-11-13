import { creatorDeps, creatorRoute, noStore } from "@/features/creators/http";
import { redeemInvite } from "@/features/creators/invites";
import {
  redeemBodySchema,
  signedContent,
  verifySigned,
} from "@/features/creators/requests";
import { parse } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/v1/creators/invites/redeem (signed, purpose `redeem`) → 201 `{ creator }`. */
export const POST = creatorRoute(
  {
    route: "v1/creators/invites/redeem",
    mutation: true,
    limit: { name: "redeem", limit: 10, windowSeconds: 600 },
  },
  async (request) => {
    const body = await parse(redeemBodySchema, { maxBytes: 4_096 })(request);
    const deps = creatorDeps();
    await verifySigned(
      deps,
      request,
      body,
      "redeem",
      null,
      signedContent({ purpose: "redeem", profile: body.profile }),
    );
    const creator = await redeemInvite(deps.db(), {
      code: body.code,
      wallet: body.wallet,
      profile: body.profile,
      now: deps.now(),
    });
    return Response.json(
      { creator: { wallet: creator.wallet, displayName: creator.displayName } },
      { status: 201, headers: noStore },
    );
  },
);

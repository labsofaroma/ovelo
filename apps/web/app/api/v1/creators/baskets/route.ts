import { creatorDeps, creatorRoute, noStore } from "@/features/creators/http";
import {
  basketBodySchema,
  signedContent,
  verifySigned,
} from "@/features/creators/requests";
import { publishBasket, saveDraft } from "@/features/creators/server";
import { parse } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/v1/creators/baskets (signed).
 * - `action: "save"` (purpose `update`): create or update a private draft → 200 `{ basket }`.
 * - `action: "publish"` (purpose `publish`): publish it, or a new version → 201 `{ basket }`.
 */
export const POST = creatorRoute(
  {
    route: "v1/creators/baskets",
    mutation: true,
    limit: { name: "baskets", limit: 20, windowSeconds: 600 },
  },
  async (request) => {
    const body = await parse(basketBodySchema, { maxBytes: 16_384 })(request);
    const deps = creatorDeps();
    const purpose = body.action === "publish" ? "publish" : "update";
    await verifySigned(
      deps,
      request,
      body,
      purpose,
      body.basketId,
      signedContent({ purpose, basket: body.basket }),
    );
    const input = {
      wallet: body.wallet,
      basketId: body.basketId,
      registry: await deps.registry(),
    };
    const basket =
      body.action === "publish"
        ? await publishBasket(deps.db(), {
            ...input,
            content: body.basket,
            now: deps.now(),
          })
        : await saveDraft(deps.db(), { ...input, content: body.basket });
    return Response.json(
      { basket },
      { status: body.action === "publish" ? 201 : 200, headers: noStore },
    );
  },
);

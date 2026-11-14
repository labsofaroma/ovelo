import { creatorDeps, creatorRoute, noStore } from "@/features/creators/http";
import {
  archiveBodySchema,
  signedContent,
  verifySigned,
} from "@/features/creators/requests";
import { basketIdSchema } from "@/features/creators/schema";
import { archiveBasket, getCreatorBasket } from "@/features/creators/server";
import { AppError } from "@/server/errors";
import { parse } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

async function basketId(context: Context): Promise<string> {
  const parsed = basketIdSchema.safeParse((await context.params).id);
  if (!parsed.success)
    throw new AppError("NOT_FOUND", { detail: "bad basket id" });
  return parsed.data;
}

/** GET /api/v1/creators/baskets/:id → a published or archived basket. Drafts are private (404). */
export const GET = creatorRoute<Context>(
  {
    route: "v1/creators/baskets/:id",
    mutation: false,
  },
  async (_request, context) => {
    const basket = await getCreatorBasket(
      creatorDeps().db(),
      await basketId(context),
    );
    if (!basket)
      throw new AppError("NOT_FOUND", { detail: "basket not found" });
    return Response.json(
      { basket },
      { headers: { "Cache-Control": "public, max-age=0, s-maxage=30" } },
    );
  },
);

/** DELETE /api/v1/creators/baskets/:id (signed, purpose `delete`): archives, never hard-deletes. */
export const DELETE = creatorRoute<Context>(
  {
    route: "v1/creators/baskets/:id",
    mutation: true,
  },
  async (request, context) => {
    const id = await basketId(context);
    const body = await parse(archiveBodySchema, { maxBytes: 2_048 })(request);
    const deps = creatorDeps();
    await verifySigned(
      deps,
      request,
      body,
      "delete",
      id,
      signedContent({ purpose: "delete" }),
    );
    const basket = await archiveBasket(deps.db(), {
      wallet: body.wallet,
      basketId: id,
    });
    return Response.json({ basket }, { headers: noStore });
  },
);

import {
  actionOptions,
  actionOrigin,
  actionRoute,
} from "@/features/baskets/action-http";
import {
  actionMetadata,
  actionQuoteRequest,
  actionTransaction,
  parseActionPost,
  resolveActionBasket,
} from "@/features/baskets/actions";
import { quoteTrade } from "@/features/trade/server/service";
import { readLimitedJson } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type Context = { params: Promise<{ id: string }> };

/**
 * Solana Action for a v1 basket (curated or published creator basket), M5b B4.
 * GET → Action metadata. POST ?amount= { account } → one unsigned mainnet transaction for that
 * account, quoted and simulated by M4's trade server, plus a `links.next` callback that records
 * the receipt once the transaction confirms. 404 when AROMA_V1_ENABLED is off.
 */
export const GET = actionRoute<Context>(
  "v1/actions/baskets/:id",
  async (request, context) => {
    const basket = await resolveActionBasket((await context.params).id);
    return Response.json(actionMetadata(basket, actionOrigin(request)));
  },
);

export const POST = actionRoute<Context>(
  "v1/actions/baskets/:id",
  async (request, context) => {
    const basket = await resolveActionBasket((await context.params).id);
    const input = parseActionPost(
      new URL(request.url).searchParams,
      await readLimitedJson(request, 2_048),
    );
    const prepared = await quoteTrade(actionQuoteRequest(basket.id, input));
    return Response.json(
      actionTransaction(prepared, basket, actionOrigin(request)),
    );
  },
);

export const OPTIONS = actionOptions;

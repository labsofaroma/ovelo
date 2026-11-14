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
import { complianceDeps } from "@/features/compliance/server/deps";
import {
  assertTradeCompliance,
  requestJurisdiction,
} from "@/features/compliance/server/gate";
import {
  surfaceAllowed,
  restrictedMessage,
} from "@/features/compliance/jurisdiction";
import { routes } from "@/features/shared/routes";
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
    const metadata = actionMetadata(basket, actionOrigin(request));
    // M9 compliance gate: a restricted or unknown location sees the Action disabled, with why.
    const policy = complianceDeps().policy();
    const jurisdiction = requestJurisdiction(request, policy);
    if (!surfaceAllowed(jurisdiction, "trade", policy))
      return Response.json({
        ...metadata,
        disabled: true,
        error: { message: restrictedMessage(jurisdiction) },
      });
    return Response.json(metadata);
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
    // M9 compliance gate: location (again, after middleware) and the account's terms acceptance.
    await assertTradeCompliance(request, input.account, complianceDeps(), {
      termsMessage: `Accept Aroma's current terms with this wallet before your first purchase: open ${actionOrigin(request)}${routes.basket(basket.id)}, connect this wallet and sign the terms. Nothing was quoted.`,
    });
    const prepared = await quoteTrade(actionQuoteRequest(basket.id, input));
    return Response.json(
      actionTransaction(prepared, basket, actionOrigin(request)),
    );
  },
);

export const OPTIONS = actionOptions;

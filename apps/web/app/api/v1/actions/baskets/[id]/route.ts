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
import { betaDeps } from "@/features/beta/server/deps";
import { reserveActionQuote } from "@/features/caps/server/caps";
import { capsDeps } from "@/features/caps/server/deps";
import { assertTradeAccess } from "@/features/beta/server/gate";
import { complianceDeps } from "@/features/compliance/server/deps";
import { requestJurisdiction } from "@/features/compliance/server/gate";
import {
  surfaceAllowed,
  restrictedMessage,
} from "@/features/compliance/jurisdiction";
import { routes } from "@/features/shared/routes";
import { quoteTrade } from "@/features/trade/server/service";
import { readLimitedJson } from "@/server/http";
import { assertTradingOpen } from "@/server/trading-switch";
import {
  ACTIONS_OFF_MESSAGE,
  actionsOff,
  assertActionsOpen,
} from "@/server/actions-switch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type Context = { params: Promise<{ id: string }> };

/**
 * Solana Action for a v1 basket (curated or published creator basket), M5b B4.
 * GET → Action metadata. POST ?amount= { account } → one unsigned mainnet transaction for that
 * account, quoted and simulated by M4's trade server, plus a `links.next` callback that records
 * the receipt once the transaction confirms. AROMA_TRADING=off refuses the POST (503), and so
 * does AROMA_ACTIONS, which is off by default under the production rules (server/actions-switch.ts).
 */
export const GET = actionRoute<Context>(
  "v1/actions/baskets/:id",
  async (request, context) => {
    const basket = await resolveActionBasket((await context.params).id);
    const metadata = actionMetadata(basket, actionOrigin(request));
    // Actions are off by default under the production rules (server/actions-switch.ts).
    if (actionsOff())
      return Response.json({
        ...metadata,
        disabled: true,
        error: {
          message: `${ACTIONS_OFF_MESSAGE.replace(" Nothing was quoted.", "")} ${actionOrigin(request)}${routes.basket(basket.id)}`,
        },
      });
    // M9 compliance gate: a restricted or unknown location sees the Action disabled, with why.
    const policy = complianceDeps().policy();
    const jurisdiction = requestJurisdiction(request, policy);
    if (!surfaceAllowed(jurisdiction, "trade", policy))
      return Response.json({
        ...metadata,
        disabled: true,
        error: { message: restrictedMessage(jurisdiction) },
      });
    // Phase A beta gate: an Action GET names no wallet, so while the gate is on it is shown
    // disabled for everyone, with where to go instead.
    if (betaDeps().config().gate)
      return Response.json({
        ...metadata,
        disabled: true,
        error: {
          message: `Aroma is in private beta. Invited wallets can buy this basket at ${actionOrigin(request)}${routes.basket(basket.id)}.`,
        },
      });
    return Response.json(metadata);
  },
);

export const POST = actionRoute<Context>(
  "v1/actions/baskets/:id",
  async (request, context) => {
    assertTradingOpen();
    assertActionsOpen();
    const basket = await resolveActionBasket((await context.params).id);
    const input = parseActionPost(
      new URL(request.url).searchParams,
      await readLimitedJson(request, 2_048),
    );
    // M9 compliance gate + Phase A beta gate (again, after middleware): location, beta access,
    // then the account's terms acceptance.
    const site = `${actionOrigin(request)}${routes.basket(basket.id)}`;
    await assertTradeAccess(
      request,
      input.account,
      { compliance: complianceDeps(), beta: betaDeps() },
      {
        beta: `Aroma is in private beta. Redeem an invite with this wallet at ${site} before buying. Nothing was quoted.`,
        terms: `Accept Aroma's current terms with this wallet before your first purchase: open ${site}, connect this wallet and sign the terms. Nothing was quoted.`,
      },
    );
    const prepared = await quoteTrade(actionQuoteRequest(basket.id, input));
    // Phase A caps (W3): the same per-trade and daily checks as the ticket. The Blink client
    // sends the transaction itself, so the amount is reserved now and kept for the day.
    await reserveActionQuote(capsDeps(), {
      requestId: prepared.requestId,
      wallet: input.account,
      inputMint: prepared.quote.inputMint,
      amountRaw: BigInt(prepared.quote.maxDebit),
      expiresAt: prepared.expiresAt,
    });
    return Response.json(
      actionTransaction(prepared, basket, actionOrigin(request)),
    );
  },
);

export const OPTIONS = actionOptions;

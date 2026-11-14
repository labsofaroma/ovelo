import { betaDeps } from "@/features/beta/server/deps";
import { assertTradeAccess } from "@/features/beta/server/gate";
import { checkQuoteCaps, requestedRaw } from "@/features/caps/server/caps";
import { capsDeps } from "@/features/caps/server/deps";
import { complianceDeps } from "@/features/compliance/server/deps";
import { quoteRequestSchema } from "@/features/trade/schema";
import { quoteTrade } from "@/features/trade/server/service";
import { assertTradingOpen } from "@/server/trading-switch";
import { assertSameOrigin, errorResponse, parse } from "@/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/v1/trade/quote: one stock or one basket. Returns `{ transactions[], authorization,
 * quote }`: unsigned, simulated transactions, an HMAC authorization bound to their exact bytes
 * and the wallet, and the reviewed figures (source, route, price impact, fees, as-of, expiry).
 * Nothing is signed or stored by the server.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    assertTradingOpen();
    assertSameOrigin(request);
    const body = await parse(quoteRequestSchema, { maxBytes: 4_096 })(request);
    // M9 compliance gate + Phase A beta gate (again, after middleware): location, then beta
    // access, then current terms accepted.
    await assertTradeAccess(request, body.taker, {
      compliance: complianceDeps(),
      beta: betaDeps(),
    });
    // Phase A caps (W3): a pre-check on the amount asked for (no route is built for an order
    // over the cap), then the check that counts, on the maximum debit the authorization carries
    // (all legs together).
    const caps = capsDeps();
    const asked = requestedRaw(body.inputMint, body.amount);
    if (asked !== null)
      await checkQuoteCaps(caps, {
        wallet: body.taker,
        inputMint: body.inputMint,
        amountRaw: asked,
      });
    const prepared = await quoteTrade(body);
    const limits = await checkQuoteCaps(caps, {
      wallet: body.taker,
      inputMint: prepared.quote.inputMint,
      amountRaw: BigInt(prepared.quote.maxDebit),
    });
    return Response.json(
      { ...prepared, limits },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return errorResponse(error, { route: "v1/trade/quote" });
  }
}

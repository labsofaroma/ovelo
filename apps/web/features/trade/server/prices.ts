import "server-only";
import { z } from "zod";
import { JupiterPriceClient } from "@/lib/sdk/jupiter/price";
import { AppError } from "@/server/errors";
import { fixedFromNumber } from "../../shared/fixed";
import { pricesResponseSchema, type PricesResponse } from "../prices-schema";

/**
 * Fresh token prices for paper practice (GET /api/v1/prices?mints=…). Paper fills require a price
 * observed within two minutes (lib/sdk/paper), which a cached page snapshot cannot promise. Each
 * price carries its source and observation time; a missing price is omitted, never invented.
 */
export const pricesQuerySchema = z
  .string()
  .transform((value) => value.split(",").filter(Boolean))
  .pipe(
    z
      .array(z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/))
      .min(1)
      .max(12),
  );

export { pricesResponseSchema, type PricesResponse } from "../prices-schema";

/** api.jup.ag needs a key; without one, Jupiter's keyless host (rate-limited) is used. */
function defaultPriceClient(): JupiterPriceClient {
  const apiKey = process.env.JUPITER_API_KEY?.split(",")[0]?.trim();
  return new JupiterPriceClient(
    apiKey ? { apiKey } : { baseUrl: "https://lite-api.jup.ag/price/v3" },
  );
}

export async function freshPrices(
  mints: readonly string[],
  client: Pick<JupiterPriceClient, "getPrices"> = defaultPriceClient(),
  now: () => number = Date.now,
): Promise<PricesResponse> {
  let prices: Record<string, number>;
  try {
    try {
      prices = await client.getPrices([...mints]);
    } catch (first) {
      // One paced retry when Jupiter rate-limits (keyless deployments share a small quota).
      if ((first as { statusCode?: unknown }).statusCode !== 429) throw first;
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      prices = await client.getPrices([...mints]);
    }
  } catch (cause) {
    throw new AppError("UPSTREAM_UNAVAILABLE", {
      detail: "Jupiter price request failed",
      cause,
    });
  }
  return pricesResponseSchema.parse({
    source: "Jupiter Price V3",
    observedAt: new Date(now()).toISOString(),
    prices: mints.flatMap((mint) => {
      const price = fixedFromNumber(prices[mint], 8);
      return price && BigInt(price.raw) > 0n ? [{ mint, price }] : [];
    }),
  });
}

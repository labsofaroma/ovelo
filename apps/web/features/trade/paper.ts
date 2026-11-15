import { formatUnits } from "@ovelo/ui/format";
import type { MarketAsset, MarketBasket } from "@/lib/sdk/markets/types";
import { createPaperAccount, parsePaperAccount } from "@/lib/sdk/paper/account";
import { executePaperBasket } from "@/lib/sdk/paper/basket";
import { executePaperOrder } from "@/lib/sdk/paper/orders";
import type { PaperAccount } from "@/lib/sdk/paper/types";
import type { PricesResponse } from "./prices-schema";
import type { PaperQuote } from "./flow";

/**
 * Paper practice (PRODUCT.md: labelled as practice, never a real transaction). Uses lib/sdk/paper
 * with FRESH observed prices from /api/v1/prices; a leg without a price makes the whole paper
 * order unavailable, exactly like a live basket. The account lives in this browser only.
 */
export const PAPER_KEY = "ovelo.v1.paper";
const PAPER_TTL_MS = 60_000;

export type PaperLeg = {
  mint: string;
  symbol: string;
  name: string;
  weightBps: number;
};

function toNumber(raw: string, decimals: number): number {
  return Number(raw) / 10 ** decimals;
}

function asset(
  leg: PaperLeg,
  priceUsd: number,
  observedAt: string,
): MarketAsset {
  return {
    mint: leg.mint,
    symbol: leg.symbol,
    name: leg.name,
    decimals: null,
    issuer: "other",
    kind: "equity",
    logoUrl: null,
    priceUsd,
    change24hPct: null,
    volume24hUsd: null,
    liquidityUsd: null,
    marketCapUsd: null,
    updatedAt: observedAt,
    priceObservedAt: observedAt,
    verified: true,
    sourceUrl: "",
    underlyingSymbol: leg.symbol,
    tradingHalted: false,
  };
}

export function buildPaperQuote(
  kind: "spot" | "basket",
  legs: readonly PaperLeg[],
  amountUsd: string,
  prices: PricesResponse,
  now: number,
): PaperQuote {
  const amount = Number(amountUsd);
  if (!Number.isFinite(amount) || amount <= 0)
    throw Object.assign(new Error("Enter an amount greater than zero."), {
      code: "VALIDATION_FAILED",
    });
  return {
    channel: "paper",
    kind,
    amountUsd,
    legs: legs.map((leg) => {
      const found = prices.prices.find((p) => p.mint === leg.mint);
      if (!found)
        throw Object.assign(
          new Error(
            `No observed price for ${leg.symbol} right now. Paper orders need a live price.`,
          ),
          { code: "ASSET_UNAVAILABLE" },
        );
      const price = toNumber(found.price.raw, found.price.decimals);
      const quantity = (amount * leg.weightBps) / 10_000 / price;
      return {
        symbol: leg.symbol,
        priceUsd: formatUnits(BigInt(found.price.raw), found.price.decimals, {
          fractionDigits: 4,
        }).text,
        quantity: quantity.toPrecision(6),
      };
    }),
    pricesObservedAt: prices.observedAt,
    quotedAt: new Date(now).toISOString(),
    expiresAt: now + PAPER_TTL_MS,
  };
}

export function loadPaperAccount(
  storage: Pick<Storage, "getItem"> | null,
): PaperAccount {
  try {
    const parsed = parsePaperAccount(
      JSON.parse(storage?.getItem(PAPER_KEY) ?? "null"),
    );
    return parsed ?? createPaperAccount();
  } catch {
    return createPaperAccount();
  }
}

/** Apply a paper order to the local account. Throws (with lib/sdk's message) when it cannot fill. */
export function fillPaper(
  account: PaperAccount,
  kind: "spot" | "basket",
  legs: readonly PaperLeg[],
  amountUsd: string,
  prices: PricesResponse,
  now: string,
): PaperAccount {
  const assets = legs.map((leg) => {
    const found = prices.prices.find((p) => p.mint === leg.mint);
    if (!found) throw new Error(`No observed price for ${leg.symbol}.`);
    return asset(
      leg,
      toNumber(found.price.raw, found.price.decimals),
      prices.observedAt,
    );
  });
  if (kind === "spot")
    return executePaperOrder(
      account,
      assets[0]!,
      "buy",
      Number(amountUsd),
      now,
    );
  const basket: MarketBasket = {
    id: "paper",
    name: "Paper basket",
    ticker: "PAPER",
    description: "",
    assets: assets.map((a, i) => ({ asset: a, weight: legs[i]!.weightBps })),
    available: true,
    missingSymbols: [],
  };
  return executePaperBasket(account, basket, Number(amountUsd), now);
}

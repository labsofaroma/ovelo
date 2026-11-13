import type { MarketBasket } from "../../markets";
import {
  MAX_CUSTOM_BASKET_LEGS,
  type BasketAllocation,
  type ProgrammableBasket,
} from "./types";
import { isRecord, validateProgrammableBasket } from "./validate";

/** Compact URL-safe encoder for sharing custom basket links. */
export function encodeBasketShareCode(basket: ProgrammableBasket): string {
  const payload: Record<string, unknown> = {
    n: basket.name,
    t: basket.ticker,
    d: basket.description,
    c: basket.category,
    a: basket.allocations.map((a) => [a.mint, a.symbol, a.weightBps]),
    r: basket.rebalanceRules.driftThresholdBps,
  };
  if (basket.creatorName) payload.u = basket.creatorName;
  if (basket.creatorSocial) payload.s = basket.creatorSocial;

  const json = JSON.stringify(payload);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(json).toString("base64url");
  }
  return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decodes a shared basket link payload into a valid ProgrammableBasket. */
export function decodeBasketShareCode(code: string): ProgrammableBasket | null {
  try {
    const padded = code.replace(/-/g, "+").replace(/_/g, "/");
    let json: string;
    if (typeof Buffer !== "undefined") {
      json = Buffer.from(code, "base64url").toString("utf8");
    } else {
      json = atob(padded);
    }
    const parsed = JSON.parse(json);
    if (!isRecord(parsed) || !Array.isArray(parsed.a)) return null;

    const allocations: BasketAllocation[] = parsed.a.map((item: unknown) => {
      if (!Array.isArray(item) || item.length < 3)
        throw new Error("Invalid allocation array");
      return {
        mint: String(item[0]),
        symbol: String(item[1]),
        weightBps: Number(item[2]),
      };
    });

    return validateProgrammableBasket({
      id: `custom-shared-${Date.now()}`,
      name: String(parsed.n || "Shared Basket"),
      ticker: String(parsed.t || "CUSTOM"),
      description: String(parsed.d || "Shared programmable basket"),
      category: parsed.c || "custom",
      allocations,
      rebalanceRules: { driftThresholdBps: Number(parsed.r) || 500 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isCustom: true,
      creatorName: typeof parsed.u === "string" ? parsed.u : undefined,
      creatorSocial: typeof parsed.s === "string" ? parsed.s : undefined,
    });
  } catch {
    return null;
  }
}

/** Forks any existing curated basket into an editable custom basket. */
export function forkCuratedBasket(basket: MarketBasket): ProgrammableBasket {
  // Keep the editable basket bound; live route capacity is checked at quote time.
  const topAssets = basket.assets.slice(0, MAX_CUSTOM_BASKET_LEGS);
  const count = topAssets.length;
  const base = Math.floor(10_000 / count);
  const remainder = 10_000 % count;
  const allocations: BasketAllocation[] = topAssets.map((item, i) => ({
    mint: item.asset.mint,
    symbol: item.asset.symbol,
    name: item.asset.name,
    weightBps: base + (i < remainder ? 1 : 0),
  }));

  const now = new Date().toISOString();
  return {
    id: `custom-${Date.now()}-${basket.id.slice(0, 8)}`,
    name: `My ${basket.name.replace(/^The /i, "")}`,
    ticker: `MY-${basket.ticker.replace(/^SOL-/i, "")}`,
    description: `Customized version of ${basket.name}. Adjusted allocations for personal thesis.`,
    category: basket.category ?? "custom",
    allocations,
    rebalanceRules: { driftThresholdBps: 500, schedule: "none" },
    createdAt: now,
    updatedAt: now,
    isCustom: true,
  };
}

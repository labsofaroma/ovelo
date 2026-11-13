import {
  CANONICAL_BASKET_DEFINITIONS,
  REVIEWED_BASKET_DEFINITIONS,
} from "./definitions";
import { positive } from "./parse";
import type {
  BasketConstituentDefinition,
  MarketAsset,
  MarketBasket,
} from "./types";

/** Research-only constituent identities. These unresolved symbols are never tradable mints. */
export function resolveCanonicalBasket(id: string): MarketBasket | null {
  const normId = id.trim().toLowerCase();
  const allDefs = [
    ...REVIEWED_BASKET_DEFINITIONS,
    ...CANONICAL_BASKET_DEFINITIONS.filter((d) => d.id !== "sol-core"),
  ];
  const def = allDefs.find(
    (d) => d.id.toLowerCase() === normId || d.ticker.toLowerCase() === normId,
  );
  if (!def || !def.symbols.length) return null;
  const count = def.symbols.length;
  const assets = def.symbols.map((symbol, index) => ({
    asset: {
      mint: `unresolved:${symbol.toLowerCase()}`,
      symbol,
      underlyingSymbol: symbol,
      name: symbol,
      issuer: def.issuer,
      kind: "equity" as const,
      verified: false,
      tradingHalted: false,
      priceUsd: null,
      change24hPct: null,
      decimals: null,
      logoUrl: null,
      volume24hUsd: null,
      liquidityUsd: null,
      marketCapUsd: null,
      updatedAt: null,
      priceObservedAt: null,
      sourceUrl: "https://api.xstocks.fi/api/v2/public/assets",
    },
    weight: Math.floor(10_000 / count) + (index < 10_000 % count ? 1 : 0),
  }));
  return {
    id: def.id,
    name: def.name,
    ticker: def.ticker,
    category: def.category,
    description: def.description,
    assets,
    available: false,
    missingSymbols: [...def.symbols],
    unpricedSymbols: [...def.symbols],
  };
}

/** Canonical baskets also back devnet test plans; never silently rewrite their IDs. */
export function resolveMarketBaskets(
  assets: MarketAsset[],
  options: { reviewedOnly?: boolean; includeAll?: boolean } = {},
): MarketBasket[] {
  const definitions: BasketConstituentDefinition[] =
    CANONICAL_BASKET_DEFINITIONS.map((def) => {
      if (def.id === "sol-pre-stocks") {
        return {
          ...def,
          symbols: [
            ...new Set(
              assets
                .filter(
                  (asset) =>
                    asset.issuer === "prestocks" && !asset.tradingHalted,
                )
                .map((asset) => asset.underlyingSymbol),
            ),
          ].sort(),
        };
      }
      return def;
    });

  const reviewed = REVIEWED_BASKET_DEFINITIONS;
  const sourceDefinitions = options.reviewedOnly
    ? reviewed
    : options.includeAll
      ? [...reviewed, ...definitions.filter((d) => d.id !== "sol-core")]
      : definitions;

  return sourceDefinitions.map((definition) => {
    const found = definition.symbols.map((symbol) =>
      assets.find(
        (asset) =>
          asset.issuer === definition.issuer &&
          asset.underlyingSymbol.toUpperCase() === symbol.toUpperCase(),
      ),
    );
    const missingSymbols = definition.symbols.filter(
      (_, index) => !found[index],
    );
    const count = definition.symbols.length;
    const members = found.flatMap((asset, index) =>
      asset
        ? [
            {
              asset,
              weight:
                Math.floor(10_000 / count) + (index < 10_000 % count ? 1 : 0),
            },
          ]
        : [],
    );
    const unpricedSymbols = members
      .filter(({ asset }) => positive(asset.priceUsd) === null)
      .map(({ asset }) => asset.underlyingSymbol);
    return {
      id: definition.id,
      name: definition.name,
      ticker: definition.ticker,
      category: definition.category,
      description: definition.description,
      assets: members,
      missingSymbols,
      unpricedSymbols,
      available:
        count > 0 &&
        missingSymbols.length === 0 &&
        unpricedSymbols.length === 0 &&
        members.every(({ asset }) => asset.verified && !asset.tradingHalted),
      // Execution route and liquidity must be checked against the fresh order; historical audits are not availability guarantees.
    };
  });
}

/** Fresh order construction still validates every leg, amount and atomic transaction. */
export function resolveReviewedMarketBaskets(
  assets: MarketAsset[],
): MarketBasket[] {
  return resolveMarketBaskets(assets, { reviewedOnly: true });
}

export function resolveAllMarketBaskets(assets: MarketAsset[]): MarketBasket[] {
  return resolveMarketBaskets(assets, { includeAll: true });
}

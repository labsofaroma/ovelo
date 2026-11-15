/**
 * The devnet test instruments for Ovelo Guard v1: valueless mock stocks, each registered with the
 * REAL Pyth feed id of its underlying equity (@ovelo/guard/pyth). The ScaledUiAmount
 * multipliers copy the live mainnet xStocks values read on 2026-11-14 (slot 469,277,079), so the
 * scaled-amount path runs on devnet exactly as it will for real xStocks.
 */
import { CANONICAL_BASKET_DEFINITIONS } from "../../../../apps/web/lib/sdk/markets/definitions";
import { XSTOCKS_PYTH_FEEDS } from "@ovelo/guard/pyth";

export type DevnetAsset = {
  symbol: string;
  underlying: string;
  feedId: string;
  decimals: number;
  multiplier: number;
};

const MULTIPLIERS: Record<string, number> = {
  AAPL: 1.0038023030588032,
  MSFT: 1.0059033904787456,
  NVDA: 1.001701196801074,
};

export const DEVNET_ASSETS: DevnetAsset[] = (
  ["AAPL", "MSFT", "NVDA"] as const
).map((underlying) => {
  const feed = XSTOCKS_PYTH_FEEDS[underlying];
  if (!feed) throw new Error(`No Pyth feed for ${underlying}`);
  return {
    symbol: `x${underlying}`,
    underlying,
    feedId: feed.equityReferenceFeedId.replace(/^0x/, ""),
    decimals: 8,
    multiplier: MULTIPLIERS[underlying]!,
  };
});

export const TEST_USD = { symbol: "tUSD", decimals: 6 } as const;

/** Every devnet asset must be a constituent of a canonical basket (no orphan instruments). */
export function basketSymbols(): Set<string> {
  return new Set(CANONICAL_BASKET_DEFINITIONS.flatMap((d) => d.symbols));
}

export const feedBytes = (hex: string) =>
  Uint8Array.from(Buffer.from(hex.replace(/^0x/, ""), "hex"));

/** `--symbols AAPL,msft` → devnet assets; refuses unknown symbols and symbols in no basket. */
export function selectAssets(symbols: string | undefined) {
  const wanted = symbols
    ? [
        ...new Set(
          symbols
            .split(",")
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean),
        ),
      ]
    : DEVNET_ASSETS.map((a) => a.underlying);
  const unknown = wanted.filter(
    (s) => !DEVNET_ASSETS.some((a) => a.underlying === s),
  );
  if (unknown.length)
    throw new Error(`Not devnet assets: ${unknown.join(", ")}`);
  const orphans = wanted.filter((s) => !basketSymbols().has(s));
  if (orphans.length)
    throw new Error(`Not in any canonical basket: ${orphans.join(", ")}`);
  return DEVNET_ASSETS.filter((a) => wanted.includes(a.underlying));
}

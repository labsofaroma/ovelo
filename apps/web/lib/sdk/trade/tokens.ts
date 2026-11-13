import { MAINNET_USDC_MINT } from "../markets";
import {
  MAINNET_SOL_MINT,
  MAINNET_USDT_MINT,
  type MainnetHolding,
  type SwapToken,
} from "./types";

export const BASE_SWAP_TOKENS: readonly SwapToken[] = [
  {
    mint: MAINNET_SOL_MINT,
    symbol: "SOL",
    name: "Solana",
    decimals: 9,
    verified: true,
    source: "network",
    logoUrl: null,
    priceUsd: null,
    tradingHalted: false,
  },
  {
    mint: MAINNET_USDC_MINT,
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    verified: true,
    source: "network",
    logoUrl: null,
    priceUsd: null,
    tradingHalted: false,
  },
  {
    mint: MAINNET_USDT_MINT,
    symbol: "USDT",
    name: "Tether USD",
    decimals: 6,
    verified: true,
    source: "network",
    logoUrl: null,
    priceUsd: null,
    tradingHalted: false,
  },
];

/** Normalize real discovery responses without claiming that all indexed tokens are verified. */
export function parseJupiterSwapTokens(value: unknown): SwapToken[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const token = item as Record<string, unknown>;
    if (
      typeof token.id !== "string" ||
      !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(token.id) ||
      typeof token.symbol !== "string" ||
      !token.symbol.trim() ||
      token.symbol.length > 40 ||
      typeof token.name !== "string" ||
      !token.name.trim() ||
      token.name.length > 160 ||
      typeof token.decimals !== "number" ||
      !Number.isInteger(token.decimals) ||
      token.decimals < 0 ||
      token.decimals > 18
    )
      return [];
    return [
      {
        mint: token.id,
        symbol: token.symbol,
        name: token.name,
        decimals: token.decimals,
        verified: token.isVerified === true,
        source: "jupiter" as const,
        logoUrl:
          typeof token.icon === "string" && token.icon.startsWith("https://")
            ? token.icon
            : null,
        priceUsd:
          typeof token.usdPrice === "number" &&
          Number.isFinite(token.usdPrice) &&
          token.usdPrice > 0
            ? token.usdPrice
            : null,
        tradingHalted: false,
      },
    ];
  });
}

export function holdingToSwapToken(holding: MainnetHolding): SwapToken {
  return {
    mint: holding.mint,
    symbol: holding.symbol,
    name: holding.name,
    decimals: holding.decimals ?? null,
    source: holding.source ?? "wallet",
    verified: holding.verified === true,
    logoUrl: holding.logoUrl ?? null,
    priceUsd: holding.priceUsd,
    tradingHalted: holding.tradingHalted === true,
  };
}

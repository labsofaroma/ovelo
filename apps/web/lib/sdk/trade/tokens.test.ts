import { expect, test } from "vitest";
import { parseJupiterSwapTokens, MAINNET_SOL_MINT } from "./index";

test("token discovery preserves unknown prices and real verification flags", () => {
  const payload = [
    {
      id: MAINNET_SOL_MINT,
      symbol: "SOL",
      name: "Solana",
      decimals: 9,
      isVerified: true,
      usdPrice: 101.23,
    },
  ];
  const [verified] = parseJupiterSwapTokens(payload);
  expect(verified.verified).toBe(true);
  expect(verified.priceUsd).toBe(101.23);
  const [unverified] = parseJupiterSwapTokens([
    { ...payload[0], isVerified: "true", usdPrice: null },
  ]);
  expect(unverified.verified).toBe(false);
  expect(unverified.priceUsd).toBe(null);
  expect(unverified.source).toBe("jupiter");
});

test("token discovery rejects malformed identities and unsupported decimal metadata", () => {
  const valid = {
    id: MAINNET_SOL_MINT,
    symbol: "SOL",
    name: "Solana",
    decimals: 9,
  };
  const malformed = [
    null,
    { ...valid, id: "invalid" },
    { ...valid, name: "" },
    { ...valid, symbol: "" },
    { ...valid, decimals: 19 },
    { ...valid, decimals: 1.5 },
  ];
  expect(parseJupiterSwapTokens(malformed)).toEqual([]);
  expect(parseJupiterSwapTokens({ error: "unavailable" })).toEqual([]);
});

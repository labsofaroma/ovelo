import { expect, test } from "vitest";
import { calculateCreatorPoints } from "./creator";
import { calculateMarketCapWeights } from "./custom";
import type { MarketAsset } from "../markets";

test("creator points preserve exact units and reward active subscribers independently", () => {
  expect(calculateCreatorPoints("99999999", 0)).toBe("0");
  expect(calculateCreatorPoints("100000000", 2)).toBe("201");
  expect(calculateCreatorPoints("12345678901234567890", 0)).toBe(
    "123456789012",
  );
  expect(() => calculateCreatorPoints("-1", 0)).toThrow();
  expect(() => calculateCreatorPoints("1", 1.5)).toThrow();
});
test("market-cap weights require observed caps and conserve all basis points", () => {
  const selected = [
    { mint: "first", symbol: "A" },
    { mint: "second", symbol: "B" },
    { mint: "third", symbol: "C" },
  ];
  const catalog = selected.map((asset) => ({
    ...asset,
    underlyingMarketCapUsd: 1,
  })) as MarketAsset[];
  expect(
    calculateMarketCapWeights(selected, catalog).map((a) => a.weightBps),
  ).toEqual([3334, 3333, 3333]);
  expect(() => calculateMarketCapWeights(selected, [])).toThrow(/unavailable/);
});

import { describe, expect, it } from "vitest";
import { createPaperAccount } from "@/lib/sdk/paper/account";
import { mint } from "../test/fixtures";
import {
  buildPaperQuote,
  fillPaper,
  loadPaperAccount,
  PAPER_KEY,
} from "./paper";

const NOW = Date.parse("2026-11-13T12:00:00.000Z");
const prices = {
  source: "Jupiter Price V3" as const,
  observedAt: new Date(NOW).toISOString(),
  prices: [
    { mint: mint(1), price: { raw: "10000000000", decimals: 8 } }, // $100
    { mint: mint(2), price: { raw: "5000000000", decimals: 8 } }, // $50
  ],
};
const legs = [
  { mint: mint(1), symbol: "AAx", name: "A", weightBps: 5000 },
  { mint: mint(2), symbol: "BBx", name: "B", weightBps: 5000 },
];

describe("paper practice", () => {
  it("quotes a basket from fresh observed prices and fills it without any transaction", () => {
    const quote = buildPaperQuote("basket", legs, "100", prices, NOW);
    expect(quote.channel).toBe("paper");
    expect(quote.legs.map((l) => l.quantity)).toEqual(["0.500000", "1.00000"]);
    expect(quote.pricesObservedAt).toBe(prices.observedAt);
    const after = fillPaper(
      createPaperAccount(1000),
      "basket",
      legs,
      "100",
      prices,
      prices.observedAt,
    );
    expect(after.cashUsd).toBe(900);
    expect(after.positions).toHaveLength(2);
  });

  it("a leg without an observed price makes the paper order unavailable", () => {
    expect(() =>
      buildPaperQuote(
        "basket",
        legs,
        "100",
        { ...prices, prices: prices.prices.slice(0, 1) },
        NOW,
      ),
    ).toThrow(/No observed price for BBx/);
  });

  it("a stale price is refused by lib/sdk at fill time", () => {
    expect(() =>
      fillPaper(
        createPaperAccount(1000),
        "spot",
        legs.slice(0, 1),
        "10",
        prices,
        new Date(NOW + 10 * 60_000).toISOString(),
      ),
    ).toThrow(/Refresh market prices/);
  });

  it("loads a stored account, and falls back to a fresh one on corrupt storage", () => {
    const stored = JSON.stringify(createPaperAccount(42));
    expect(
      loadPaperAccount({ getItem: (k) => (k === PAPER_KEY ? stored : null) })
        .cashUsd,
    ).toBe(42);
    expect(loadPaperAccount({ getItem: () => "{oops" }).cashUsd).toBe(10_000);
    expect(loadPaperAccount(null).cashUsd).toBe(10_000);
  });
});

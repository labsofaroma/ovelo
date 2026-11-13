import { describe, expect, test } from "vitest";
import type { MarketBasket } from "../../markets";
import {
  decodeBasketShareCode,
  encodeBasketShareCode,
  forkCuratedBasket,
} from "./share";
import type { ProgrammableBasket } from "./types";

const mint = (n: number) => String(n).padStart(32, "1");
const basket = (
  overrides: Partial<ProgrammableBasket> = {},
): ProgrammableBasket => ({
  id: "custom-1",
  name: "My Basket",
  ticker: "MY-ONE",
  description: "A sample basket",
  category: "custom",
  allocations: [
    { mint: mint(1), symbol: "AAA", weightBps: 6000 },
    { mint: mint(2), symbol: "BBB", weightBps: 4000 },
  ],
  rebalanceRules: { driftThresholdBps: 250 },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  isCustom: true,
  ...overrides,
});

describe("share codes", () => {
  test("round-trip allocations, rules and creator details", () => {
    const original = basket({
      creatorName: "Sample Creator",
      creatorSocial: "https://x.com/sample",
    });
    const code = encodeBasketShareCode(original);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    const decoded = decodeBasketShareCode(code);
    expect(decoded).toMatchObject({
      name: "My Basket",
      ticker: "MY-ONE",
      isCustom: true,
      rebalanceRules: { driftThresholdBps: 250 },
      creatorName: "Sample Creator",
    });
    expect(decoded?.allocations.map((a) => [a.mint, a.weightBps])).toEqual([
      [mint(1), 6000],
      [mint(2), 4000],
    ]);
    expect(decoded?.id).toMatch(/^custom-shared-/);
  });

  test("falls back to safe defaults for a sparse payload", () => {
    const code = Buffer.from(
      JSON.stringify({
        a: [
          [mint(1), "A", 5000],
          [mint(2), "B", 5000],
        ],
      }),
    ).toString("base64url");
    expect(decodeBasketShareCode(code)).toMatchObject({
      name: "Shared Basket",
      ticker: "CUSTOM",
      rebalanceRules: { driftThresholdBps: 500 },
    });
  });

  test.each([
    ["not base64 json", "%%%"],
    ["empty", ""],
    ["json but not an object", Buffer.from("[1,2]").toString("base64url")],
    [
      "no allocations",
      Buffer.from(JSON.stringify({ n: "x" })).toString("base64url"),
    ],
    [
      "malformed allocation",
      Buffer.from(JSON.stringify({ a: [["only-two", "x"]] })).toString(
        "base64url",
      ),
    ],
    [
      "invalid weights",
      Buffer.from(
        JSON.stringify({
          a: [
            [mint(1), "A", 1],
            [mint(2), "B", 1],
          ],
        }),
      ).toString("base64url"),
    ],
  ])("rejects %s with null", (_label, code) => {
    expect(decodeBasketShareCode(code)).toBeNull();
  });
});

describe("forkCuratedBasket", () => {
  const curated = (count: number): MarketBasket =>
    ({
      id: "sol-chips-and-more",
      name: "The Chips Basket",
      ticker: "SOL-CHIPS",
      category: "technology",
      description: "x",
      assets: Array.from({ length: count }, (_, i) => ({
        asset: { mint: mint(i + 1), symbol: `S${i}`, name: `Stock ${i}` },
        weight: 0,
      })),
    }) as unknown as MarketBasket;

  test("creates an editable equal-weight copy with derived names", () => {
    const fork = forkCuratedBasket(curated(3));
    expect(fork).toMatchObject({
      name: "My Chips Basket",
      ticker: "MY-CHIPS",
      category: "technology",
      isCustom: true,
      rebalanceRules: { driftThresholdBps: 500, schedule: "none" },
    });
    expect(fork.id).toMatch(/^custom-\d+-sol-chip$/);
    expect(fork.allocations.map((a) => a.weightBps)).toEqual([
      3334, 3333, 3333,
    ]);
  });

  test("caps the copy at twelve legs and still sums to 10,000", () => {
    const fork = forkCuratedBasket(curated(20));
    expect(fork.allocations).toHaveLength(12);
    expect(fork.allocations.reduce((sum, a) => sum + a.weightBps, 0)).toBe(
      10_000,
    );
  });
});

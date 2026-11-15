import { describe, expect, it } from "vitest";
import { USDC_MINT } from "../../trade/schema";
import type { Holding } from "../schema";
import { buildPnl, type ReceiptInput } from "./build";

const A = "MintAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "MintBbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const SOL = "So11111111111111111111111111111111111111112";

const holding = (
  mint: string,
  raw: string,
  price: string | null,
  over: Partial<Holding> = {},
): Holding => ({
  mint,
  symbol: mint.slice(4, 5) + "x",
  name: "Test",
  decimals: 8,
  raw,
  catalog: true,
  issuer: "xstocks",
  logoUrl: null,
  price: price === null ? null : { raw: price, decimals: 2 },
  priceObservedAt: price === null ? null : "2026-11-15T12:00:00.000Z",
  priceSource: price === null ? null : "jupiter-tokens-v2",
  value: null,
  ...over,
});
const withValue = (h: Holding): Holding => ({
  ...h,
  value: h.price
    ? {
        raw: ((BigInt(h.raw) * BigInt(h.price.raw)) / 10n ** 8n).toString(),
        decimals: 2,
      }
    : null,
});
let n = 0;
const receipt = (
  legs: { mint: string; inputAmount: string; basket?: string }[],
  over: Partial<ReceiptInput> = {},
): ReceiptInput => ({
  signature: `sig${++n}`,
  kind: legs.some((l) => l.basket) ? "basket" : "spot",
  status: "confirmed",
  mintIn: USDC_MINT,
  createdAt: new Date(2026, 10, n),
  legs: legs.map((l) => ({
    mint: l.mint,
    inputAmount: l.inputAmount,
    basket: l.basket ?? null,
    requestId: `r${n}`,
  })),
  ...over,
});
const basketName = (ref: string) => `Basket ${ref}`;

describe("buildPnl", () => {
  it("a holding bought only through Aroma: exact cost, value and unrealized P&L", () => {
    const r = receipt([{ mint: A, inputAmount: "10000000" }]); // 10 USDC
    const pnl = buildPnl({
      holdings: [withValue(holding(A, "5000000000", "300"))], // 50 tokens × $3.00 = $150
      receipts: [r],
      fills: new Map([[r.signature, { [A]: "5000000000" }]]),
      basketName,
    });
    expect(pnl.rows[0]).toMatchObject({
      status: "known",
      costUsdc: "10000000",
      value: { raw: "15000", decimals: 2 },
      unrealized: { raw: "140000000", decimals: 6 },
      unrealizedBps: 140_000,
    });
    expect(pnl.totals).toMatchObject({
      included: 1,
      excluded: 0,
      costUsdc: "10000000",
    });
  });

  it("holding more than Aroma bought: cost basis unknown (outside), left out of totals", () => {
    const r = receipt([{ mint: A, inputAmount: "10000000" }]);
    const pnl = buildPnl({
      holdings: [withValue(holding(A, "9000000000", "300"))],
      receipts: [r],
      fills: new Map([[r.signature, { [A]: "5000000000" }]]),
      basketName,
    });
    expect(pnl.rows[0]).toMatchObject({
      status: "outside",
      costUsdc: null,
      unrealized: null,
    });
    expect(pnl.totals).toMatchObject({ included: 0, excluded: 1 });
  });

  it("holding less: the difference left at average cost (half held → half the cost)", () => {
    const r = receipt([{ mint: A, inputAmount: "10000000" }]);
    const pnl = buildPnl({
      holdings: [withValue(holding(A, "2500000000", "300"))],
      receipts: [r],
      fills: new Map([[r.signature, { [A]: "5000000000" }]]),
      basketName,
    });
    expect(pnl.rows[0]).toMatchObject({ status: "known", costUsdc: "5000000" });
  });

  it("no Aroma purchase, an unread fill, a SOL-funded buy, and USDC itself are each labelled", () => {
    const pending = receipt([{ mint: B, inputAmount: "1" }]);
    const sol = receipt([{ mint: A, inputAmount: "1" }], { mintIn: SOL });
    const pnl = buildPnl({
      holdings: [
        withValue(holding(A, "1", "300")),
        withValue(holding(B, "1", "300")),
        withValue(
          holding("MintCccccccccccccccccccccccccccccccccccccccc", "1", "300"),
        ),
        holding(USDC_MINT, "1000000", "100", { decimals: 6 }),
      ],
      receipts: [pending, sol],
      fills: new Map([[sol.signature, { [A]: "1" }]]),
      basketName,
    });
    expect(pnl.rows.map((r) => r.status)).toEqual([
      "other_funding",
      "fill_pending",
      "none",
      "funding",
    ]);
    expect(pnl.totals).toMatchObject({ included: 0, excluded: 3 });
  });

  it("an unpriced holding with a known cost: cost shown, P&L not, left out of totals", () => {
    const r = receipt([{ mint: A, inputAmount: "10000000" }]);
    const pnl = buildPnl({
      holdings: [holding(A, "5000000000", null)],
      receipts: [r],
      fills: new Map([[r.signature, { [A]: "5000000000" }]]),
      basketName,
    });
    expect(pnl.rows[0]).toMatchObject({
      status: "known",
      costUsdc: "10000000",
      value: null,
      unrealized: null,
    });
    expect(pnl.totals.excluded).toBe(1);
  });

  it("baskets group by the receipt's basket id; one unpriced constituent hides that basket's P&L", () => {
    const r = receipt([
      { mint: A, inputAmount: "6000000", basket: "core" },
      { mint: B, inputAmount: "4000000", basket: "core" },
    ]);
    const fills = new Map([
      [r.signature, { [A]: "200000000", [B]: "100000000" }],
    ]);
    const priced = buildPnl({
      holdings: [
        withValue(holding(A, "200000000", "300")),
        withValue(holding(B, "100000000", "500")),
      ],
      receipts: [r],
      fills,
      basketName,
    });
    expect(priced.baskets).toEqual([
      expect.objectContaining({
        basket: "core",
        name: "Basket core",
        orders: 1,
        costUsdc: "10000000",
        missing: null,
      }),
    ]);
    // 2 × $3 + 1 × $5 = $11 against 10 USDC.
    expect(priced.baskets[0]!.unrealizedBps).toBe(1_000);
    const unpriced = buildPnl({
      holdings: [
        withValue(holding(A, "200000000", "300")),
        holding(B, "100000000", null),
      ],
      receipts: [r],
      fills,
      basketName,
    });
    expect(unpriced.baskets[0]).toMatchObject({
      costUsdc: null,
      unrealized: null,
      missing: "unpriced",
    });
  });

  it("pending and failed receipts never count", () => {
    const failed = receipt([{ mint: A, inputAmount: "10000000" }], {
      status: "failed",
    });
    const pnl = buildPnl({
      holdings: [withValue(holding(A, "1", "300"))],
      receipts: [failed],
      fills: new Map([[failed.signature, { [A]: "1" }]]),
      basketName,
    });
    expect(pnl.rows[0]?.status).toBe("none");
  });
});

import { describe, expect, it } from "vitest";
import { toMarketsView } from "@/features/markets/normalize";
import { mint, snapshot } from "@/features/test/fixtures";
import { quoteRequestSchema, SOL_MINT, USDC_MINT } from "../schema";
import { resolveTarget } from "./target";

/**
 * Ported from the target checks in tests/order-precision.test.mjs: same-mint, unknown, halted
 * and incomplete-catalog requests never reach routing. Precision and wallet-capability checks
 * from that suite live in quote.test.ts (on-chain decimals) and rpc.test.ts (versions).
 */
const view = toMarketsView(snapshot());
const code = (run: () => unknown) => {
  try {
    run();
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? "THREW";
  }
};

describe("resolveTarget", () => {
  it("resolves a verified, unhalted stock to a single 10,000 bps leg", () => {
    const target = resolveTarget(
      { target: { kind: "spot", mint: mint(1) }, inputMint: USDC_MINT },
      view,
    );
    expect(target).toEqual({
      kind: "spot",
      basketId: null,
      legs: [{ mint: mint(1), weightBps: 10_000, symbol: "TESTx" }],
    });
  });

  it("resolves a complete basket with weights from lib/sdk", () => {
    const target = resolveTarget(
      {
        target: { kind: "basket", basketId: "test-basket" },
        inputMint: SOL_MINT,
      },
      view,
    );
    expect(target.legs.map((l) => l.weightBps)).toEqual([5000, 5000]);
    expect(target.basketId).toBe("test-basket");
  });

  it("refuses unknown and discovery-only mints, unknown baskets and same-mint orders", () => {
    expect(
      code(() =>
        resolveTarget(
          { target: { kind: "spot", mint: mint(77) }, inputMint: USDC_MINT },
          view,
        ),
      ),
    ).toBe("ASSET_UNAVAILABLE");
    expect(
      code(() =>
        resolveTarget(
          {
            target: { kind: "basket", basketId: "nope" },
            inputMint: USDC_MINT,
          },
          view,
        ),
      ),
    ).toBe("NOT_FOUND");
    const usdcRow = { ...view.rows[0]!, mint: USDC_MINT };
    expect(
      code(() =>
        resolveTarget(
          { target: { kind: "spot", mint: USDC_MINT }, inputMint: USDC_MINT },
          { ...view, rows: [...view.rows, usdcRow] },
        ),
      ),
    ).toBe("VALIDATION_FAILED");
  });

  it("refuses halted or unverified assets, and an issuer catalog missing from the snapshot", () => {
    const halted = {
      ...view,
      rows: view.rows.map((r) => ({ ...r, tradingHalted: true })),
    };
    expect(
      code(() =>
        resolveTarget(
          { target: { kind: "spot", mint: mint(1) }, inputMint: USDC_MINT },
          halted,
        ),
      ),
    ).toBe("ASSET_UNAVAILABLE");
    expect(
      code(() =>
        resolveTarget(
          { target: { kind: "spot", mint: mint(1) }, inputMint: USDC_MINT },
          { ...view, sources: [] },
        ),
      ),
    ).toBe("ASSET_UNAVAILABLE");
  });

  it("refuses an incomplete basket instead of buying part of it", () => {
    const incomplete = {
      ...view,
      baskets: view.baskets.map((b) => ({
        ...b,
        available: false,
        missingSymbols: ["DOWN"],
      })),
    };
    expect(
      code(() =>
        resolveTarget(
          {
            target: { kind: "basket", basketId: "test-basket" },
            inputMint: USDC_MINT,
          },
          incomplete,
        ),
      ),
    ).toBe("ASSET_UNAVAILABLE");
  });
});

describe("quote request schema", () => {
  const valid = {
    target: { kind: "spot", mint: mint(1) },
    inputMint: USDC_MINT,
    amount: "12.5",
    taker: mint(5),
    supportedTransactionVersions: [0],
  };
  it("accepts a well-formed request and defaults slippage to 100 bps", () => {
    expect(quoteRequestSchema.parse(valid).slippageBps).toBe(100);
  });
  it("rejects arbitrary funding tokens, zero, negative, exponent and over-precise amounts, and wide slippage", () => {
    for (const change of [
      { inputMint: mint(9) },
      { amount: "0" },
      { amount: "-1" },
      { amount: "1e3" },
      { amount: "1.1234567890123456789" },
      { slippageBps: 301 },
      { supportedTransactionVersions: [] },
      { extra: true },
    ])
      expect(
        quoteRequestSchema.safeParse({ ...valid, ...change }).success,
      ).toBe(false);
  });
});

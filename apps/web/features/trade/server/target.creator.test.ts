import { describe, expect, it } from "vitest";
import { toMarketsView } from "@/features/markets/normalize";
import { asset, mint, snapshot } from "@/features/test/fixtures";
import type { TradeReceipt } from "@/server/auth/trade";
import { USDC_MINT } from "../schema";
import { creatorBasketId, type CreatorBasketTarget } from "./creator-target";
import { prepareQuote } from "./quote";
import { receiptRows } from "./store";
import { resolveTarget } from "./target";
import { builder } from "./test-harness";

/**
 * M5b B3: a PUBLISHED creator basket (Postgres) is quoted with the same rules as a curated one:
 * every constituent listed, verified and unpaused; weights from basket_allocations; simulation
 * before return; no partial orders. Receipts carry the basket id (FK) and the version bought.
 */
const ID = "8b2e1c4a-6f0d-4c1e-9a3b-2d5f7e9c1a20";
const view = toMarketsView(snapshot());
const creator = (
  overrides: Partial<CreatorBasketTarget> = {},
): CreatorBasketTarget => ({
  id: ID,
  version: 3,
  status: "published",
  allocations: [
    { mint: mint(1), symbol: "TESTx", weightBps: 7_000 },
    { mint: mint(2), symbol: "DOWNx", weightBps: 3_000 },
  ],
  ...overrides,
});
const request = {
  target: { kind: "basket" as const, basketId: ID },
  inputMint: USDC_MINT,
};
const refusal = (run: () => unknown) => {
  try {
    run();
    return "ok";
  } catch (error) {
    const e = error as {
      code?: string;
      publicMessage?: string;
      message?: string;
    };
    return e.code ?? "THREW";
  }
};

describe("creatorBasketId", () => {
  it("UUIDs are creator baskets; curated slugs and null are not", () => {
    expect(creatorBasketId(ID)).toBe(ID);
    expect(creatorBasketId(ID.toUpperCase())).toBe(ID);
    expect(creatorBasketId("sol-core")).toBeNull();
    expect(creatorBasketId("test-basket")).toBeNull();
    expect(creatorBasketId(null)).toBeNull();
  });
});

describe("resolveTarget with a creator basket", () => {
  it("uses the creator's weights and records the version", () => {
    expect(resolveTarget(request, view, creator())).toEqual({
      kind: "basket",
      basketId: ID,
      basketVersion: 3,
      legs: [
        { mint: mint(1), symbol: "TESTx", weightBps: 7_000 },
        { mint: mint(2), symbol: "DOWNx", weightBps: 3_000 },
      ],
    });
  });

  it("an archived basket cannot be bought", () => {
    expect(() =>
      resolveTarget(request, view, creator({ status: "archived" })),
    ).toThrow(/archived/);
  });

  it("an unknown basket (or a loaded basket with another id) is 404", () => {
    expect(refusal(() => resolveTarget(request, view, null))).toBe("NOT_FOUND");
    expect(
      refusal(() =>
        resolveTarget(
          request,
          view,
          creator({ id: "00000000-0000-4000-8000-000000000000" }),
        ),
      ),
    ).toBe("NOT_FOUND");
  });

  it("a constituent that is no longer listed refuses the whole basket (no partial order)", () => {
    const gone = creator({
      allocations: [
        { mint: mint(1), symbol: "TESTx", weightBps: 5_000 },
        { mint: mint(99), symbol: "GONEx", weightBps: 5_000 },
      ],
    });
    expect(refusal(() => resolveTarget(request, view, gone))).toBe(
      "ASSET_UNAVAILABLE",
    );
  });

  it("a paused or unverified constituent refuses the whole basket", () => {
    for (const change of [{ tradingHalted: true }, { verified: false }]) {
      const paused = toMarketsView(
        snapshot({
          assets: [
            asset(),
            asset({ mint: mint(2), symbol: "DOWNx", ...change }),
          ],
        }),
      );
      expect(refusal(() => resolveTarget(request, paused, creator()))).toBe(
        "ASSET_UNAVAILABLE",
      );
    }
  });

  it("weights that do not sum to exactly 10,000 bps are refused", () => {
    for (const weights of [
      [7_000, 2_999],
      [7_000, 3_001],
      [10_000, 0],
    ]) {
      const skewed = creator({
        allocations: [
          { mint: mint(1), symbol: "TESTx", weightBps: weights[0]! },
          { mint: mint(2), symbol: "DOWNx", weightBps: weights[1]! },
        ],
      });
      expect(refusal(() => resolveTarget(request, view, skewed))).toBe(
        "ASSET_UNAVAILABLE",
      );
    }
  });

  it("a curated slug ignores any creator basket passed in", () => {
    const target = resolveTarget(
      {
        target: { kind: "basket", basketId: "test-basket" },
        inputMint: USDC_MINT,
      },
      view,
      creator(),
    );
    expect(target.basketId).toBe("test-basket");
    expect(target.basketVersion).toBeUndefined();
  });
});

describe("prepareQuote with a creator basket", () => {
  it("simulates before returning, and the authorized receipt carries the id and version", async () => {
    const run = builder({ basket: true });
    let receipt: TradeReceipt | null = null;
    const deps = {
      ...run.deps,
      authorize: async (input: Parameters<typeof run.deps.authorize>[0]) => {
        receipt = input.receipt;
        return run.deps.authorize(input);
      },
    };
    const target = {
      ...run.request.target,
      kind: "basket" as const,
      basketId: ID,
      basketVersion: 3,
    };
    const order = await prepareQuote({ ...run.request, target }, deps);
    expect(run.calls.simulations).toBeGreaterThan(0);
    expect(order.quote.basketId).toBe(ID);
    expect(order.quote.basketVersion).toBe(3);
    expect(receipt).toMatchObject({
      kind: "basket",
      basketId: ID,
      basketVersion: 3,
    });
  });
});

describe("receipt rows", () => {
  const record = (basketId: string, basketVersion?: number) => ({
    id: "11111111-1111-4111-8111-111111111111",
    taker: "Taker1111111111111111111111111111111111111",
    signatures: ["sig-a"],
    receipt: {
      kind: "basket" as const,
      basketId,
      ...(basketVersion ? { basketVersion } : {}),
      inputMint: USDC_MINT,
      inAmount: "2000050",
      legs: [
        {
          mint: mint(1),
          inputAmount: "1400000",
          outAmount: "1",
          minimumAmount: "1",
          tx: 0,
        },
        {
          mint: mint(2),
          inputAmount: "600000",
          outAmount: "1",
          minimumAmount: "1",
          tx: 0,
        },
      ],
    },
  });

  it("creator baskets set basket_id and the version on every leg", () => {
    const [row] = receiptRows(record(ID, 3));
    expect(row!.basketId).toBe(ID);
    expect(row!.amountIn).toBe("2000000");
    expect(row!.legs).toEqual([
      expect.objectContaining({ basket: ID, basketVersion: 3 }),
      expect.objectContaining({ basket: ID, basketVersion: 3 }),
    ]);
  });

  it("curated baskets keep basket_id null (M4 decision 6) and carry no version", () => {
    const [row] = receiptRows(record("sol-core"));
    expect(row!.basketId).toBeNull();
    expect(row!.legs[0]).not.toHaveProperty("basketVersion");
  });
});

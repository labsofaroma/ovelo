import { expect, test } from "vitest";
import {
  validateProgrammableBasket,
  calculateEqualWeights,
  autoBalanceWeights,
  resolveProgrammableBasket,
  encodeBasketShareCode,
  decodeBasketShareCode,
  formatSocialUrl,
} from "./index";
import {
  executePaperRebalance,
  createPaperAccount,
  executePaperOrder,
} from "../../paper";
import { testAsset } from "../../markets/test-fixtures";
import type { ProgrammableBasket } from "./types";

test("validates programmable basket invariants (2 to 12 assets, 10000 bps sum)", () => {
  const valid = {
    id: "custom-test-1",
    name: "AI & Tech",
    ticker: "MY-TECH",
    description: "My custom basket",
    allocations: [
      {
        mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
        symbol: "AAPL",
        weightBps: 5000,
      },
      {
        mint: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
        symbol: "NVDA",
        weightBps: 5000,
      },
    ],
    rebalanceRules: { driftThresholdBps: 500 },
  };

  const parsed = validateProgrammableBasket(valid);
  expect(parsed.id).toBe("custom-test-1");
  expect(parsed.allocations.length).toBe(2);
  expect(parsed.isCustom).toBe(true);

  // Rejects 1 asset (baskets must have at least 2 constituents)
  expect(() =>
    validateProgrammableBasket({
      ...valid,
      allocations: [
        {
          mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
          symbol: "AAPL",
          weightBps: 10000,
        },
      ],
    }),
  ).toThrow(/between 2 and 12 assets/);

  // Rejects 13 assets; live route capacity is checked separately before signing.
  expect(() =>
    validateProgrammableBasket({
      ...valid,
      allocations: Array.from({ length: 13 }, (_, i) => ({
        mint: `mint${String(i).padStart(32, "1")}`,
        symbol: `ASSET${i}`,
        weightBps: 1000,
      })),
    }),
  ).toThrow(/between 2 and 12 assets/);

  // Rejects sum not equal to 10000 bps
  expect(() =>
    validateProgrammableBasket({
      ...valid,
      allocations: [
        {
          mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
          symbol: "AAPL",
          weightBps: 4000,
        },
        {
          mint: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
          symbol: "NVDA",
          weightBps: 5000,
        },
      ],
    }),
  ).toThrow(/sum to exactly 10,000 basis points/);

  // Rejects duplicate mints
  expect(() =>
    validateProgrammableBasket({
      ...valid,
      allocations: [
        {
          mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
          symbol: "AAPL",
          weightBps: 5000,
        },
        {
          mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
          symbol: "AAPL2",
          weightBps: 5000,
        },
      ],
    }),
  ).toThrow(/Duplicate asset/);
});

test("equal-weight distribution conserves every basis point (Hare-Niemeyer)", () => {
  const three = calculateEqualWeights([
    { mint: "mint11111111111111111111111111111111", symbol: "A" },
    { mint: "mint22222222222222222222222222222222", symbol: "B" },
    { mint: "mint33333333333333333333333333333333", symbol: "C" },
  ]);
  expect(three.length).toBe(3);
  expect(three.reduce((sum, a) => sum + a.weightBps, 0)).toBe(10000);
  expect(three[0]!.weightBps).toBe(3334);
  expect(three[1]!.weightBps).toBe(3333);
  expect(three[2]!.weightBps).toBe(3333);
});

test("auto-balance distribution conserves every basis point via Hare-Niemeyer", () => {
  // Case 1: Proportional scaling when sum < 10,000 without zero legs
  const under = autoBalanceWeights([
    { mint: "mint1", symbol: "A", weightBps: 5000 },
    { mint: "mint2", symbol: "B", weightBps: 3000 },
  ]);
  expect(under.reduce((sum, a) => sum + a.weightBps, 0)).toBe(10000);
  expect(under[0]!.weightBps).toBe(6250);
  expect(under[1]!.weightBps).toBe(3750);

  // Case 2: Proportional scaling when sum > 10,000 (e.g. 45%, 35%, 25% = 105%)
  const over = autoBalanceWeights([
    { mint: "mint1", symbol: "A", weightBps: 4500 },
    { mint: "mint2", symbol: "B", weightBps: 3500 },
    { mint: "mint3", symbol: "C", weightBps: 2500 },
  ]);
  expect(over.reduce((sum, a) => sum + a.weightBps, 0)).toBe(10000);
  expect(over[0]!.weightBps).toBe(4286);
  expect(over[1]!.weightBps).toBe(3333);
  expect(over[2]!.weightBps).toBe(2381);

  // Case 3: Distribute unallocated remainder to zero-weight legs
  const withZero = autoBalanceWeights([
    { mint: "mint1", symbol: "A", weightBps: 6000 },
    { mint: "mint2", symbol: "B", weightBps: 2000 },
    { mint: "mint3", symbol: "C", weightBps: 0 },
  ]);
  expect(withZero.reduce((sum, a) => sum + a.weightBps, 0)).toBe(10000);
  expect(withZero[0]!.weightBps).toBe(6000);
  expect(withZero[1]!.weightBps).toBe(2000);
  expect(withZero[2]!.weightBps).toBe(2000);

  // Case 4: All zero weights fallback to equal weights via Hare-Niemeyer
  const allZero = autoBalanceWeights([
    { mint: "mint1", symbol: "A", weightBps: 0 },
    { mint: "mint2", symbol: "B", weightBps: 0 },
    { mint: "mint3", symbol: "C", weightBps: 0 },
  ]);
  expect(allZero.reduce((sum, a) => sum + a.weightBps, 0)).toBe(10000);
  expect(allZero[0]!.weightBps).toBe(3334);
  expect(allZero[1]!.weightBps).toBe(3333);
  expect(allZero[2]!.weightBps).toBe(3333);
});

test("share code encodes and decodes custom baskets reliably", () => {
  const basket: ProgrammableBasket = {
    id: "custom-orig",
    name: "Trio",
    ticker: "TRIO",
    description: "Three stocks",
    allocations: [
      {
        mint: "mint11111111111111111111111111111111",
        symbol: "A",
        weightBps: 3334,
      },
      {
        mint: "mint22222222222222222222222222222222",
        symbol: "B",
        weightBps: 3333,
      },
      {
        mint: "mint33333333333333333333333333333333",
        symbol: "C",
        weightBps: 3333,
      },
    ],
    rebalanceRules: { driftThresholdBps: 300 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isCustom: true,
  };

  const code = encodeBasketShareCode(basket);
  expect(typeof code === "string" && code.length > 0).toBeTruthy();

  const decoded = decodeBasketShareCode(code)!;
  expect(decoded).toBeTruthy();
  expect(decoded.name).toBe("Trio");
  expect(decoded.ticker).toBe("TRIO");
  expect(decoded.allocations.length).toBe(3);
  expect(decoded.rebalanceRules.driftThresholdBps).toBe(300);

  // Corrupted code returns null
  expect(decodeBasketShareCode("not-a-valid-base64-payload!")).toBe(null);
});

test("paper rebalancing atomically sells overweighted assets and buys underweighted assets", () => {
  const now = new Date().toISOString();
  const assets = [
    testAsset({
      mint: "mintA",
      symbol: "A",
      priceUsd: 100,
      verified: true,
      tradingHalted: false,
      priceObservedAt: now,
    }),
    testAsset({
      mint: "mintB",
      symbol: "B",
      priceUsd: 100,
      verified: true,
      tradingHalted: false,
      priceObservedAt: now,
    }),
  ];
  let account = createPaperAccount(10000);
  // Buy $2,000 of A and $1,000 of B (A is 66.6%, B is 33.3%)
  account = executePaperOrder(account, assets[0]!, "buy", 2000, now);
  account = executePaperOrder(account, assets[1]!, "buy", 1000, now);

  const targets = [
    { mint: "mintA", weightBps: 5000 },
    { mint: "mintB", weightBps: 5000 },
  ];

  // Drift threshold 500 bps (5%). Since A is ~66.6% vs 50% target, drift is 16.6% > 5%.
  const {
    account: rebalancedAccount,
    rebalanced,
    legs,
  } = executePaperRebalance(account, targets, assets, 500);

  expect(rebalanced).toBe(true);
  expect(legs.length).toBe(2);

  const posA = rebalancedAccount.positions.find((p) => p.mint === "mintA")!;
  const posB = rebalancedAccount.positions.find((p) => p.mint === "mintB")!;
  expect(posA && posB).toBeTruthy();

  // Both should now be valued at approx $1,500 each (50/50 of $3,000 total portfolio)
  expect(Math.abs(posA.quantity * 100 - 1500) < 1).toBeTruthy();
  expect(Math.abs(posB.quantity * 100 - 1500) < 1).toBeTruthy();
});

test("formatSocialUrl handles @handles, domains, full urls, and empty values", () => {
  expect(formatSocialUrl(undefined)).toBe(undefined);
  expect(formatSocialUrl("")).toBe(undefined);
  expect(formatSocialUrl("   ")).toBe(undefined);
  expect(formatSocialUrl("@satoshinakamoto")).toBe(
    "https://x.com/satoshinakamoto",
  );
  expect(formatSocialUrl("x.com/satoshinakamoto")).toBe(
    "https://x.com/satoshinakamoto",
  );
  expect(formatSocialUrl("https://github.com/solana-labs")).toBe(
    "https://github.com/solana-labs",
  );
  expect(formatSocialUrl("http://myblog.xyz")).toBe("http://myblog.xyz");
});

test("creator name and optional social link are preserved across validation, resolution, and sharing", () => {
  const basket = {
    id: "custom-creator-test",
    name: "Alpha Titans",
    ticker: "ALPHA",
    description: "Alpha generation portfolio",
    creatorName: "Alice Walker",
    creatorSocial: "@alicewalker",
    allocations: [
      {
        mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
        symbol: "AAPL",
        weightBps: 5000,
      },
      {
        mint: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
        symbol: "NVDA",
        weightBps: 5000,
      },
    ],
    rebalanceRules: { driftThresholdBps: 500 },
  };

  const validated = validateProgrammableBasket(basket);
  expect(validated.creatorName).toBe("Alice Walker");
  expect(validated.creatorSocial).toBe("https://x.com/alicewalker");

  // Optional social link (omitted)
  const validatedNoSocial = validateProgrammableBasket({
    ...basket,
    creatorSocial: undefined,
  });
  expect(validatedNoSocial.creatorName).toBe("Alice Walker");
  expect(validatedNoSocial.creatorSocial).toBe(undefined);

  // Encode & decode share code preserves creator
  const code = encodeBasketShareCode(validated);
  const decoded = decodeBasketShareCode(code)!;
  expect(decoded).toBeTruthy();
  expect(decoded.creatorName).toBe("Alice Walker");
  expect(decoded.creatorSocial).toBe("https://x.com/alicewalker");

  // Resolution exposes creator attribution to MarketBasket
  const assets = [
    testAsset({
      mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
      symbol: "AAPL",
      priceUsd: 200,
      verified: true,
      tradingHalted: false,
    }),
    testAsset({
      mint: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
      symbol: "NVDA",
      priceUsd: 130,
      verified: true,
      tradingHalted: false,
    }),
  ];
  const resolved = resolveProgrammableBasket(validated, assets);
  expect(resolved.creatorName).toBe("Alice Walker");
  expect(resolved.creatorSocial).toBe("https://x.com/alicewalker");
  expect(resolved.isCustom).toBe(true);
});

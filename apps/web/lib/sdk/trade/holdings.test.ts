import { expect, test } from "vitest";
import {
  aggregateTokenBalances,
  maxSwapAmount,
  holdingToSwapToken,
  MAINNET_SOL_MINT,
} from "./index";
import type { MainnetHolding } from "./types";
const owner = "11111111111111111111111111111111";
const mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const tokenProgram = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const token2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/** A typed holding: identity plus "unknown" valuation; tests state the fields they rely on. */
function holding(overrides: Partial<MainnetHolding>): MainnetHolding {
  return {
    mint,
    symbol: "TEST",
    name: "Test token",
    amount: "0",
    displayAmount: null,
    priceUsd: null,
    valueUsd: null,
    valuationUnavailableReason: null,
    ...overrides,
  };
}
function account({
  tokenMint = mint,
  amount = "123456789",
  decimals = 6,
  uiAmountString = "123.456789" as string | null,
  state = "initialized",
  program = tokenProgram,
  accountOwner = owner,
} = {}) {
  return {
    account: {
      owner: program,
      data: {
        parsed: {
          type: "account",
          info: {
            mint: tokenMint,
            owner: accountOwner,
            state,
            tokenAmount: { amount, decimals, uiAmountString },
          },
        },
      },
    },
  };
}
test("all account balances combine precisely and frozen funds stay visible but unspendable", () => {
  const result = aggregateTokenBalances(
    [
      account({
        amount: "9007199254740993",
        uiAmountString: "9007199254.740993",
      }),
      account({ amount: "7", uiAmountString: "0.000007" }),
      account({ amount: "1000000", uiAmountString: "1", state: "frozen" }),
      account({
        tokenMint: MAINNET_SOL_MINT,
        amount: "1000",
        decimals: 9,
        uiAmountString: "0.000001",
        program: token2022,
      }),
    ],
    owner,
  );
  expect(result.length).toBe(2);
  expect(result[0].rawAmount).toBe("9007199255741000");
  expect(result[0].spendableRawAmount).toBe("9007199254741000");
  expect(result[0].displayAmount).toBe("9007199255.741");
  expect(result[1].tokenProgram).toBe(token2022);
});
test("scaled token displays remain separate from raw amounts and missing displays stay unknown", () => {
  const scaled = aggregateTokenBalances(
    [account({ amount: "1000000", uiAmountString: "1.75" })],
    owner,
  )[0];
  expect(scaled.rawAmount).toBe("1000000");
  expect(scaled.displayAmount).toBe("1.75");
  expect(
    aggregateTokenBalances([account({ uiAmountString: null })], owner)[0]
      .displayAmount,
  ).toBe(null);
  expect(
    aggregateTokenBalances(
      [account({ amount: "0", uiAmountString: "0" })],
      owner,
    ).length,
  ).toBe(0);
});
test("malformed, foreign-owned and contradictory account data fail closed", () => {
  for (const row of [
    account({ amount: "-1" }),
    account({ amount: "1e6" }),
    account({ amount: "18446744073709551616" }),
    account({ decimals: 256 }),
    account({ accountOwner: mint }),
    account({ state: "uninitialized" }),
    account({ program: owner }),
    {},
  ])
    expect(() => aggregateTokenBalances([row], owner)).toThrow(/RPC/);
  expect(() =>
    aggregateTokenBalances([account(), account({ decimals: 8 })], owner),
  ).toThrow(/inconsistent/);
  expect(() =>
    aggregateTokenBalances([account(), account({ program: token2022 })], owner),
  ).toThrow(/inconsistent/);
});
test("tokens beyond swap precision remain visible without offering an unsafe amount", () => {
  const balance = aggregateTokenBalances(
    [
      account({
        amount: "1",
        decimals: 19,
        uiAmountString: "0.0000000000000000001",
      }),
    ],
    owner,
  )[0];
  expect(balance.rawAmount).toBe("1");
  expect(balance.decimals).toBe(19);
  expect(
    maxSwapAmount(
      holding({
        mint,
        decimals: 19,
        spendableAmount: "0.0000000000000000001",
      }),
    ),
  ).toBe("0");
});
test("Max reserves SOL without rounding and never spends frozen or unverified balance units", () => {
  expect(
    maxSwapAmount(
      holding({
        mint: MAINNET_SOL_MINT,
        decimals: 9,
        spendableAmount: "1.123456789",
      }),
    ),
  ).toBe("1.113456789");
  expect(
    maxSwapAmount(
      holding({
        mint: MAINNET_SOL_MINT,
        decimals: 9,
        spendableAmount: "0.005",
      }),
    ),
  ).toBe("0");
  expect(
    maxSwapAmount(
      holding({ mint, decimals: 6, spendableAmount: "9007199254.740993" }),
    ),
  ).toBe("9007199254.740993");
  expect(maxSwapAmount(holding({ mint, amount: "100", decimals: 6 }))).toBe(
    "0",
  );
  expect(
    maxSwapAmount(
      holding({
        mint,
        decimals: 6,
        spendableAmount: "100",
        tradingHalted: true,
      }),
    ),
  ).toBe("0");
});
test("wallet identity metadata does not imply verification or invent prices", () => {
  const token = holdingToSwapToken(
    holding({
      mint,
      symbol: "UNKNOWN",
      name: "Unidentified wallet token",
      priceUsd: null,
    }),
  );
  expect(token.verified).toBe(false);
  expect(token.source).toBe("wallet");
  expect(token.decimals).toBe(null);
  expect(token.priceUsd).toBe(null);
});

// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { LiveQuote } from "../flow";
import { ReviewPanel } from "./ReviewPanel";

/** W3: the review shows the beta limits from the SERVER's figures, never computed in the browser. */
afterEach(cleanup);
const noop = () => {};

function live(limits?: LiveQuote["limits"]): LiveQuote {
  return {
    channel: "live",
    requestId: "r1",
    authorization: "a",
    transactions: ["AA"],
    mode: "single",
    transactionVersion: 0,
    expiresAt: Date.now() + 60_000,
    lastValidBlockHeight: 1,
    quote: {
      kind: "spot",
      basketId: null,
      source: "Jupiter",
      quotedAt: new Date().toISOString(),
      inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      inputSymbol: "USDC",
      inputDecimals: 6,
      inAmount: "1000000",
      maxDebit: "1000000",
      slippageBps: 100,
      legs: [
        {
          mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
          symbol: "AAPLx",
          decimals: 8,
          weightBps: 10_000,
          inputAmount: "1000000",
          outAmount: "400000",
          minimumAmount: "396000",
          priceImpactPct: "0.001",
          hops: 1,
          tx: 0,
        },
      ],
      fees: {
        baseFeeLamports: "5000",
        priorityFeeLamports: null,
        tipLamports: "0",
        platformFeeBps: 0,
      },
      unitsConsumed: 1,
      atomicityWarning: null,
    },
    ...(limits ? { limits } : {}),
  };
}

const show = (quote: LiveQuote) =>
  render(
    <ReviewPanel
      quote={quote}
      expired={false}
      onConfirm={noop}
      onRequote={noop}
      onCancel={noop}
      busy={false}
    />,
  );

describe("ReviewPanel beta limits", () => {
  it("shows max per trade and what is left today from the quote's limits", () => {
    show(
      live({
        perTradeRaw: "50000000",
        dailyRaw: "200000000",
        usedTodayRaw: "62500000",
        remainingTodayRaw: "137500000",
        notionalRaw: "1000000",
        day: "2026-11-14",
      }),
    );
    expect(screen.getByText("Beta limits")).toBeTruthy();
    expect(
      screen.getByText(
        "max $50 per trade, $137.50 left today (UTC, before this trade)",
      ),
    ).toBeTruthy();
  });

  it("shows nothing when the server sent no limits (no invented figures)", () => {
    show(live());
    expect(screen.queryByText("Beta limits")).toBeNull();
  });
});

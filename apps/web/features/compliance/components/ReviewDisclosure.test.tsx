// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ReviewPanel } from "../../trade/components/ReviewPanel";
import type { AnyQuote, LiveQuote } from "../../trade/flow";
import { disclosureLines, DISCLOSURE_VERSION } from "../disclosures";
import { RiskDisclosure } from "./RiskDisclosure";

/**
 * M9 compliance gate, C4: every live trade review renders the risk disclosure, and the confirm
 * control exists only INSIDE it, so a review cannot confirm without the disclosure rendered.
 */
afterEach(cleanup);
const noop = () => {};
const NOW = Date.now();

function liveQuote(
  kind: "spot" | "basket",
  basketId: string | null = null,
): LiveQuote {
  return {
    channel: "live",
    requestId: "r1",
    authorization: "a",
    transactions: ["AA"],
    mode: "single",
    transactionVersion: 0,
    expiresAt: NOW + 60_000,
    lastValidBlockHeight: 1,
    quote: {
      kind,
      basketId,
      source: "Jupiter",
      quotedAt: new Date(NOW).toISOString(),
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
  };
}

const renderReview = (quote: AnyQuote, expired = false) =>
  render(
    <ReviewPanel
      quote={quote}
      expired={expired}
      onConfirm={noop}
      onRequote={noop}
      onCancel={noop}
      busy={false}
    />,
  );

const disclosure = () =>
  screen.getByRole("region", { name: "Risk disclosure" });

describe("risk disclosure on every trade review", () => {
  it.each([
    ["stock", liveQuote("spot"), "spot"],
    ["curated basket", liveQuote("basket", "sol-core"), "basket"],
    [
      "creator basket",
      liveQuote("basket", "8b2e1c4a-6f0d-4c1e-9a3b-2d5f7e9c1a20"),
      "creator-basket",
    ],
  ] as const)(
    "%s: disclosure rendered, confirm only inside it",
    (_, quote, surface) => {
      renderReview(quote);
      const region = disclosure();
      expect(region.getAttribute("data-disclosure-surface")).toBe(surface);
      expect(region.getAttribute("data-disclosure-version")).toBe(
        DISCLOSURE_VERSION,
      );
      for (const line of disclosureLines(surface))
        expect(within(region).getByText(line)).toBeTruthy();
      const confirm = screen.getByRole("button", {
        name: "Sign and buy on mainnet",
      });
      expect(region.contains(confirm)).toBe(true);
      expect(
        within(region).getByText("Placeholder text: pending counsel"),
      ).toBeTruthy();
    },
  );

  it("an expired live quote still shows the disclosure around its re-quote control", () => {
    renderReview(liveQuote("spot"), true);
    expect(
      disclosure().contains(
        screen.getByRole("button", { name: /Quote expired/ }),
      ),
    ).toBe(true);
  });

  it("there is no confirm control anywhere outside the disclosure", () => {
    renderReview(liveQuote("spot"));
    const buttons = screen.getAllByRole("button");
    for (const button of buttons)
      expect(disclosure().contains(button)).toBe(true);
  });

  it("the disclosure has no dismiss, collapse or hide control", () => {
    render(
      <RiskDisclosure surface="spot">
        <span>child</span>
      </RiskDisclosure>,
    );
    expect(within(disclosure()).queryAllByRole("button")).toHaveLength(0);
    expect(disclosure().querySelector("details")).toBeNull();
    expect(disclosure().hidden).toBe(false);
  });

  it("paper practice (no transaction) has no disclosure", () => {
    renderReview({
      channel: "paper",
      kind: "spot",
      amountUsd: "10",
      legs: [],
      pricesObservedAt: null,
      quotedAt: new Date(NOW).toISOString(),
      expiresAt: NOW + 60_000,
    });
    expect(
      screen.queryByRole("region", { name: "Risk disclosure" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Place paper order" }),
    ).toBeTruthy();
  });

  it("the devnet recurring surface says test tokens only and none of the mainnet lines", () => {
    expect(disclosureLines("recurring-devnet")).toEqual([
      expect.stringMatching(/devnet test with test tokens/),
    ]);
  });
});

describe("review markup (axe definition-list, found by the M9 fork E2E)", () => {
  it("every child of the review <dl> is a div holding exactly a dt and a dd", () => {
    renderReview(liveQuote("basket", "sol-core"));
    const dl = document.querySelector("dl")!;
    for (const child of Array.from(dl.children)) {
      expect(child.tagName).toBe("DIV");
      expect(Array.from(child.children).map((c) => c.tagName)).toEqual([
        "DT",
        "DD",
      ]);
    }
  });
});

// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { QueryProvider } from "../../shared/components/QueryProvider";
import type { PlanView, TimelineEntryView } from "../schema";
import { FaucetPanel } from "./FaucetPanel";
import { InvestUnavailable, NOT_DEPLOYED_MESSAGE } from "./InvestUnavailable";
import { PlanCard } from "./PlanCard";
import { PlanTimeline } from "./PlanTimeline";

afterEach(cleanup);

const SIG =
  "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
const T = "1763000000";
const executed: TimelineEntryView = {
  period: 0,
  scheduledAt: T,
  status: "executed",
  recordedOnChain: true,
  executions: [
    {
      signature: SIG,
      blockTime: "1763000100",
      periodComplete: true,
      legs: [
        {
          leg: 0,
          mint: "So11111111111111111111111111111111111111112",
          symbol: "AAPL",
          amountIn: "10000000",
          amountOut: "4321",
          minOut: "4200",
          oraclePrice: "23142000000",
          oracleExpo: -8,
          oraclePublishTime: "1763000090",
        },
      ],
    },
  ],
};
const row = (
  period: number,
  status: TimelineEntryView["status"],
  recordedOnChain = false,
): TimelineEntryView => ({
  period,
  scheduledAt: String(Number(T) + period * 604_800),
  status,
  recordedOnChain,
  executions: [],
});
const entries = [
  executed,
  row(1, "skipped", true),
  row(2, "skipped", false),
  row(3, "due"),
  row(4, "in_progress", true),
  row(5, "unindexed", true),
  row(6, "pending"),
];
const timelineProps = {
  fundingSymbol: "tUSD",
  fundingDecimals: 6,
  cluster: "devnet" as const,
  explorerRpcUrl: "x",
};

describe("PlanTimeline", () => {
  it("renders every status, with skipped periods clearly visible", () => {
    render(<PlanTimeline entries={entries} {...timelineProps} />);
    const rows = screen.getAllByTestId("timeline-row");
    expect(rows.map((r) => r.getAttribute("data-status"))).toEqual([
      "executed",
      "skipped",
      "skipped",
      "due",
      "in_progress",
      "unindexed",
      "pending",
    ]);
    expect(rows[1]!.textContent).toMatch(
      /Skipped: missed the catch-up window\. Recorded on-chain/,
    );
    expect(rows[2]!.textContent).toMatch(
      /will be recorded on-chain at the plan's next execution/,
    );
    expect(rows[5]!.textContent).toMatch(/details are being indexed/);
    expect(rows[6]!.textContent).toMatch(/Opens /);
  });

  it("an executed period shows its signature link, exact amounts and the exact oracle price", () => {
    render(<PlanTimeline entries={[executed]} {...timelineProps} />);
    const link = screen.getByRole("link", { name: /Transaction 5VERv8NM/ });
    expect(link.getAttribute("href")).toBe(
      `https://explorer.solana.com/tx/${SIG}?cluster=devnet`,
    );
    const text = screen.getByTestId("timeline-row").textContent ?? "";
    expect(text).toMatch(
      /AAPL: 10 tUSD → 0\.00004321 tokens at Pyth \$231\.42/,
    );
  });
});

const plan: PlanView = {
  pda: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
  owner: "o",
  status: "active",
  fundingMint: "m",
  fundingSymbol: "tUSD",
  fundingDecimals: 6,
  installmentRaw: "10000000",
  periodSeconds: "2592000",
  periods: 7,
  startsAt: T,
  expiresAt: T,
  executedPeriods: 1,
  skippedPeriods: 1,
  catchUpWindowPeriods: 1,
  outputs: [
    { mint: "a", symbol: "AAPL", weightBps: 6_000 },
    { mint: "b", symbol: "MSFT", weightBps: 4_000 },
  ],
  timeline: entries,
  timelineComplete: false,
};

describe("PlanCard", () => {
  it("shows terms in plain cadence words, counts, the split and the timeline", () => {
    render(<PlanCard plan={plan} cluster="devnet" explorerRpcUrl="x" />);
    const card = screen.getByTestId("plan-card");
    expect(card.textContent).toMatch(/10 tUSD every 30 days/);
    expect(card.textContent).not.toMatch(/monthly/i);
    expect(screen.getByTestId("plan-executed").textContent).toBe("1 of 7");
    expect(screen.getByTestId("plan-skipped").textContent).toBe("1");
    expect(card.textContent).toMatch(/AAPL 60% · MSFT 40%/);
    expect(card.textContent).toMatch(/still being indexed/);
    expect(screen.getAllByTestId("timeline-row")).toHaveLength(7);
  });
});

describe("unavailable and unconfigured states", () => {
  it("devnet not deployed: an honest message and the devnet label, nothing interactive", () => {
    render(<InvestUnavailable cluster="devnet" />);
    const section = screen.getByTestId("invest-unavailable");
    expect(section.textContent).toMatch(NOT_DEPLOYED_MESSAGE);
    expect(screen.getByTestId("cluster-label").textContent).toBe(
      "Devnet: test tokens, no real value",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("the faucet without a site key says it is not configured", () => {
    render(
      <QueryProvider>
        <FaucetPanel
          siteKey={null}
          nonce={null}
          cluster="devnet"
          explorerRpcUrl="x"
          fundingSymbol="tUSD"
          fundingDecimals={6}
          amountRaw="100000000"
        />
      </QueryProvider>,
    );
    expect(screen.getByTestId("faucet-unconfigured").textContent).toMatch(
      /not configured/,
    );
    expect(screen.queryByTestId("faucet-claim")).toBeNull();
  });

  it("the faucet with a site key offers a claim (disabled until a wallet connects)", () => {
    render(
      <QueryProvider>
        <FaucetPanel
          siteKey="1x00000000000000000000AA"
          nonce={null}
          cluster="devnet"
          explorerRpcUrl="x"
          fundingSymbol="tUSD"
          fundingDecimals={6}
          amountRaw="100000000"
        />
      </QueryProvider>,
    );
    expect(screen.getByText(/Claim 100 tUSD/)).toBeTruthy();
    expect(screen.getByTestId("faucet-claim").hasAttribute("disabled")).toBe(
      true,
    );
  });
});

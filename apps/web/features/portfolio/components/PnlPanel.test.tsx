// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { pnlCopy } from "../copy";
import type { PnlRow, PnlView } from "../pnl/schema";
import { formatBps, PnlPanel } from "./PnlPanel";

afterEach(cleanup);
const row = (over: Partial<PnlRow>): PnlRow => ({
  mint: "M",
  symbol: "Ax",
  decimals: 8,
  quantity: "100000000",
  status: "known",
  costUsdc: "10000000",
  value: { raw: "1100", decimals: 2 },
  priceSource: "jupiter-tokens-v2",
  priceObservedAt: "2026-11-15T12:00:00.000Z",
  unrealized: { raw: "1000000", decimals: 6 },
  unrealizedBps: 1000,
  ...over,
});
const view = (rows: PnlRow[], baskets: PnlView["baskets"] = []): PnlView => ({
  method: "average-cost",
  rows,
  baskets,
  totals: {
    included: 1,
    excluded: rows.length - 1,
    costUsdc: "0",
    value: { raw: "0", decimals: 2 },
    unrealized: { raw: "0", decimals: 6 },
    unrealizedBps: null,
  },
  realized: null,
  sources: [],
});

describe("formatBps (integers only)", () => {
  it.each([
    [1000, "+10.00%"],
    [-5, "−0.05%"],
    [0, "0.00%"],
    [null, "—"],
  ])("%s → %s", (bps, text) => expect(formatBps(bps)).toBe(text));
});

describe("PnlPanel", () => {
  it("a known holding shows cost, value with its price source and time, and signed P&L", () => {
    render(<PnlPanel pnl={view([row({})])} />);
    const tr = screen.getByRole("row", { name: /Ax/ });
    expect(within(tr).getByText("$10.00")).toBeTruthy();
    expect(within(tr).getByText("$11.00")).toBeTruthy();
    expect(within(tr).getByText(/Price: jupiter-tokens-v2/)).toBeTruthy();
    expect(within(tr).getByText("+$1.00")).toBeTruthy();
    expect(within(tr).getByText("+10.00%")).toBeTruthy();
  });

  it("unknown cost basis and unpriced holdings say so, with no number in place of P&L", () => {
    render(
      <PnlPanel
        pnl={view([
          row({
            symbol: "Bx",
            status: "outside",
            costUsdc: null,
            unrealized: null,
            unrealizedBps: null,
          }),
          row({
            symbol: "Cx",
            value: null,
            priceSource: null,
            priceObservedAt: null,
            unrealized: null,
            unrealizedBps: null,
          }),
        ])}
      />,
    );
    const outside = screen.getByRole("row", { name: /Bx/ });
    expect(within(outside).getByText(pnlCopy.status.outside)).toBeTruthy();
    expect(within(outside).queryByText(/^\+|−\$/)).toBeNull();
    const unpriced = screen.getByRole("row", { name: /Cx/ });
    expect(within(unpriced).getByText(pnlCopy.status.unpriced)).toBeTruthy();
    expect(within(unpriced).getAllByText("—")).toHaveLength(1);
  });

  it("funding tokens are not listed; realized P&L is explicitly not shown; baskets are honest", () => {
    render(
      <PnlPanel
        pnl={view(
          [row({ symbol: "USDC", status: "funding" })],
          [
            {
              basket: "core",
              name: "Core",
              orders: 2,
              costUsdc: null,
              value: null,
              unrealized: null,
              unrealizedBps: null,
              missing: "unpriced",
            },
          ],
        )}
      />,
    );
    expect(screen.queryByRole("row", { name: /USDC/ })).toBeNull();
    expect(screen.getByText(pnlCopy.realized)).toBeTruthy();
    expect(screen.getByText("Core")).toBeTruthy();
    expect(screen.getByText(pnlCopy.status.unpriced)).toBeTruthy();
  });

  it("unavailable receipts: one line, no table", () => {
    render(<PnlPanel pnl={null} />);
    expect(screen.getByText(pnlCopy.unavailable)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

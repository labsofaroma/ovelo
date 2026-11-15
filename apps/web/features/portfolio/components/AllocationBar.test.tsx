// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Holding, PortfolioView } from "../schema";
import { AllocationBar } from "./AllocationBar";

afterEach(cleanup);

const holding = (symbol: string, value: string | null): Holding => ({
  mint: `${symbol}-mint`,
  symbol,
  name: symbol,
  decimals: 6,
  raw: "1000000",
  catalog: true,
  issuer: null,
  logoUrl: null,
  price: value ? { raw: value, decimals: 2 } : null,
  priceObservedAt: value ? "2026-11-15T12:00:00.000Z" : null,
  priceSource: value ? "jupiter-tokens-v2" : null,
  value: value ? { raw: value, decimals: 2 } : null,
});

const view = (holdings: Holding[], priced: string): PortfolioView => ({
  wallet: "W",
  network: "mainnet-beta",
  observedAt: "2026-11-15T12:00:00.000Z",
  sol: { raw: "0", decimals: 9 },
  holdings,
  pricedValue: { raw: priced, decimals: 2 },
  unpricedCount: holdings.filter((h) => h.value === null).length,
  pricesAsOf: null,
  sources: [],
  warnings: [],
});

describe("AllocationBar", () => {
  it("shares of the priced value only; unpriced holdings are excluded, not given a share", () => {
    render(
      <AllocationBar
        portfolio={view(
          [holding("Ax", "7500"), holding("Bx", "2500"), holding("Cx", null)],
          "10000",
        )}
      />,
    );
    const legend = screen.getByRole("list", {
      name: "Allocation of priced holdings",
    });
    expect(within(legend).getByText("75.00%")).toBeTruthy();
    expect(within(legend).getByText("25.00%")).toBeTruthy();
    expect(within(legend).queryByText("Cx")).toBeNull();
    expect(screen.getByText("1 unpriced holding excluded")).toBeTruthy();
  });

  it("nothing priced: says so, no legend", () => {
    render(<AllocationBar portfolio={view([holding("Cx", null)], "0")} />);
    expect(
      screen.getByText(
        "No priced holdings, so there is no allocation to show.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });
});

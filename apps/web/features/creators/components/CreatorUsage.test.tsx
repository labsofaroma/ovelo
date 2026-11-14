// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CreatorUsage } from "./CreatorUsage";

afterEach(cleanup);
const asOf = "2026-11-14T10:00:00.000Z";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

describe("CreatorUsage (PRODUCT.md: no invented metrics)", () => {
  it("no purchases is said in words, with the source and as-of, and no zero figures", () => {
    render(
      <CreatorUsage
        usage={{ state: "none", asOf, source: "Aroma purchase receipts" }}
      />,
    );
    expect(screen.getByText("No purchases yet.")).toBeTruthy();
    expect(screen.getByText(/Source: Aroma purchase receipts/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(document.body.textContent).not.toMatch(/\b0(\.0+)?\s*USDC/);
  });

  it("shows exact volumes per funding token and the counts per window", () => {
    render(
      <CreatorUsage
        usage={{
          state: "ok",
          asOf,
          source: "Aroma purchase receipts",
          windows: [
            { window: "7d", since: asOf, purchases: 0, buyers: 0, volume: [] },
            {
              window: "all",
              since: null,
              purchases: 2,
              buyers: 1,
              volume: [
                { mint: USDC, symbol: "USDC", decimals: 6, raw: "4000001" },
              ],
            },
          ],
        }}
      />,
    );
    const rows = screen.getAllByRole("row");
    expect(rows[1]!.textContent).toContain("Last 7 days");
    expect(rows[1]!.textContent).toContain("None");
    expect(rows[2]!.textContent).toContain("4.000001 USDC");
  });

  it("an outage is unavailable, not zero", () => {
    render(<CreatorUsage usage={{ state: "unavailable", reason: "Down." }} />);
    expect(screen.getByText("Unavailable: Down.")).toBeTruthy();
  });
});

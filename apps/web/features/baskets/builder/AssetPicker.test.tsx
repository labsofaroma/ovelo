// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_LEGS } from "../../creators/schema";
import type { MarketRow } from "../../markets/schema";
import { AssetPicker } from "./AssetPicker";
import { type PickerAsset, selectableRows, toPickerAsset } from "./assets";

afterEach(cleanup);

function row(n: number, overrides: Partial<MarketRow> = {}): MarketRow {
  return {
    mint: `Mint${String(n).padStart(4, "0")}${"z".repeat(34)}`,
    symbol: `S${n}x`,
    name: `Company ${n}`,
    underlyingSymbol: `S${n}`,
    issuer: "xstocks",
    kind: "equity",
    logoUrl: null,
    verified: true,
    tradingHalted: false,
    tradingNotice: null,
    sourceUrl: "https://example.test",
    price: { raw: String(100_000_000 + n), decimals: 6 },
    priceObservedAt: "2026-11-13T11:58:00.000Z",
    priceSource: "jupiter-tokens-v2",
    change24h: null,
    volume24h: null,
    liquidity: null,
    marketCap: null,
    reference: null,
    ...overrides,
  };
}

let toggled: string[] = [];
function Harness({ assets }: { assets: PickerAsset[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  return (
    <AssetPicker
      assets={assets}
      selected={selected}
      onToggle={(asset) => {
        toggled.push(asset.symbol);
        const next = new Set(selected);
        if (next.has(asset.mint)) next.delete(asset.mint);
        else next.add(asset.mint);
        setSelected(next);
      }}
    />
  );
}

describe("selectableRows", () => {
  it("keeps only registered, tradable, priced rows and counts the rest by reason", () => {
    const { rows, excluded } = selectableRows([
      row(2),
      row(1),
      row(3, { verified: false }),
      row(4, { tradingHalted: true }),
      row(5, { price: null, priceSource: null }),
    ]);
    expect(rows.map((r) => r.symbol)).toEqual(["S1x", "S2x"]);
    expect(excluded).toEqual({ unverified: 1, halted: 1, unpriced: 1 });
  });
});

describe("AssetPicker", () => {
  it("shows price with its source, and searches by symbol or name", async () => {
    toggled = [];
    const user = userEvent.setup();
    render(<Harness assets={[row(1), row(2), row(12)].map(toPickerAsset)} />);
    const first = screen.getByRole("button", { name: /S1x/ });
    expect(first.textContent).toContain("$100.00");
    expect(first.textContent).toContain("Jupiter");
    await user.type(screen.getByRole("searchbox"), "company 12");
    const list = screen.getAllByRole("button");
    expect(list).toHaveLength(1);
    expect(list[0]!.textContent).toContain("S12x");
  });

  it("toggles selection with aria-pressed and the keyboard", async () => {
    toggled = [];
    const user = userEvent.setup();
    render(<Harness assets={[row(1), row(2)].map(toPickerAsset)} />);
    const button = screen.getByRole("button", { name: /S2x/ });
    button.focus();
    await user.keyboard("{Enter}");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    await user.keyboard(" ");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(toggled).toEqual(["S2x", "S2x"]);
  });

  it("lists unavailable assets with the reason and does not let them be added", async () => {
    toggled = [];
    const user = userEvent.setup();
    render(
      <Harness
        assets={[
          row(1, { price: null, priceSource: null }),
          row(2, { verified: false }),
        ].map(toPickerAsset)}
      />,
    );
    const unpriced = screen.getByRole("button", { name: /S1x/ });
    expect(unpriced).toHaveProperty("disabled", true);
    expect(within(unpriced).getByText("No token price observed")).toBeTruthy();
    expect(screen.getByText("Not verified by the issuer")).toBeTruthy();
    await user.click(unpriced);
    expect(toggled).toEqual([]);
  });

  it(`stops at ${MAX_LEGS} assets`, async () => {
    toggled = [];
    const user = userEvent.setup();
    const assets = Array.from({ length: MAX_LEGS + 2 }, (_, i) =>
      toPickerAsset(row(i + 10)),
    );
    render(<Harness assets={assets} />);
    for (const asset of assets.slice(0, MAX_LEGS))
      await user.click(
        screen.getByRole("button", {
          name: new RegExp(`^\\S*\\s*${asset.symbol}`),
        }),
      );
    expect(screen.getByRole("status").textContent).toContain(
      "The basket is full",
    );
    const extra = screen.getByRole("button", {
      name: new RegExp(assets[MAX_LEGS]!.symbol),
    });
    expect(extra).toHaveProperty("disabled", true);
  });
});

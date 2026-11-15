// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { routes } from "../../shared/routes";
import { toMarketsView } from "../../markets/normalize";
import { asset, snapshot } from "../../test/fixtures";
import { Landing } from "./Landing";
import { MarketSnapshot } from "./MarketSnapshot";

vi.mock("./LandingMotionLazy", () => ({ LandingMotionLazy: () => null }));

afterEach(cleanup);

const unavailable = {
  state: "unavailable" as const,
  error: { code: "UPSTREAM_UNAVAILABLE" as const, message: "unavailable" },
};

const internal = new Set<string>(
  Object.values(routes).filter((r) => typeof r === "string"),
);

describe("Landing links and button texts", () => {
  it("does not say spot trading is still coming (it is live since M9)", () => {
    render(<Landing snapshot={unavailable} />);
    expect(document.body.textContent).not.toMatch(/Coming to this preview/);
  });

  it("gives each mode card a link to where that mode is used", () => {
    render(<Landing snapshot={unavailable} />);
    const modes = screen.getByRole("region", {
      name: "Three ways to use Ovelo, always labelled",
    });
    const links = within(modes)
      .getAllByRole("link")
      .map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([
      ["Buy on mainnet", routes.markets],
      ["Try the devnet test", routes.invest],
      ["Pick a stock to practise", routes.markets],
    ]);
  });

  it("has distinct call-to-action texts and only internal, named links", () => {
    render(<Landing snapshot={unavailable} />);
    const links = screen.getAllByRole("link");
    const texts = links.map((a) => a.textContent?.trim() ?? "");
    expect(texts).toContain("Explore markets");
    expect(texts).toContain("See baskets");
    expect(texts).toContain("Browse all listings");
    expect(texts).not.toContain("Open markets");
    for (const link of links) {
      expect(link.textContent?.trim()).not.toBe("");
      expect(internal.has(link.getAttribute("href") ?? "")).toBe(true);
    }
  });
});

describe("MarketSnapshot highlight logos", () => {
  it("shows the stock's logo (or its tile) next to each highlighted listing", () => {
    const view = toMarketsView(
      snapshot({
        assets: [
          asset({ logoUrl: "https://xstocks-metadata.backed.fi/logos/t.png" }),
        ],
        baskets: [],
      }),
    );
    const data = {
      asOf: view.asOf,
      sources: view.sources,
      pulse: view.pulse,
      highlights: view.rows,
      basketCount: 0,
    };
    const { container } = render(
      <MarketSnapshot snapshot={{ state: "ok", data }} />,
    );
    const row = view.rows[0]!;
    const link = screen.getByRole("link", { name: row.symbol });
    const dt = link.closest("dt")!;
    expect(dt.querySelector("[data-size='sm']")).not.toBeNull();
    expect(container.querySelector("img")?.getAttribute("src")).toContain(
      encodeURIComponent("xstocks-metadata.backed.fi"),
    );
  });
});

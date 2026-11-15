// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { toMarketsView } from "../normalize";
import { snapshot } from "../../test/fixtures";
import { PulseStrip } from "./PulseStrip";

afterEach(cleanup);

describe("PulseStrip", () => {
  it("labels the section, ranks movers in tabs and states breadth coverage", async () => {
    const view = toMarketsView(snapshot());
    render(<PulseStrip view={view} />);
    const section = screen.getByRole("region", { name: "Market pulse" });
    const tabs = within(section).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Most traded",
      "Gainers",
      "Losers",
    ]);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    expect(section.textContent).toContain(
      `Breadth covers ${view.pulse.coveredAssets === 1 ? "1 asset" : `${view.pulse.coveredAssets} assets`}`,
    );
    expect(section.textContent).toMatch(/As of /);
    await userEvent.setup().click(tabs[1]!);
    expect(tabs[1]?.getAttribute("aria-selected")).toBe("true");
  });

  it("says breadth is unavailable instead of showing 0% when nothing has 24h data", () => {
    const view = toMarketsView(snapshot());
    render(
      <PulseStrip
        view={{
          ...view,
          pulse: {
            ...view.pulse,
            coveredAssets: 0,
            advancing: 0,
            declining: 0,
            unchanged: 0,
          },
        }}
      />,
    );
    expect(
      screen.getByRole("img", { name: "No asset has 24h change data" }),
    ).toBeTruthy();
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
  });
});

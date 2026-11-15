// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { routes } from "../../shared/routes";
import { investCopy } from "../copy";
import { MainnetRecurringComing } from "./MainnetRecurringComing";

afterEach(cleanup);

const panel = () => screen.getByTestId("mainnet-recurring-coming");

describe("MainnetRecurringComing (M10 Path B)", () => {
  it("is a labelled region with its own heading", () => {
    render(<MainnetRecurringComing />);
    const region = screen.getByRole("region", {
      name: investCopy.mainnet.heading,
    });
    expect(region).toBe(panel());
    expect(within(region).getByRole("heading", { level: 2 }).textContent).toBe(
      "Mainnet recurring: coming",
    );
  });

  it("states that it is unavailable and the real reasons (DCA-SPIKE.md)", () => {
    render(<MainnetRecurringComing />);
    expect(within(panel()).getByRole("status").textContent).toMatch(
      /not available yet/,
    );
    const items = within(panel())
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "");
    expect(items).toHaveLength(2);
    expect(items[0]).toMatch(/Token-2022/);
    expect(items[1]).toMatch(/custodial vault/);
  });

  it("promises no date", () => {
    render(<MainnetRecurringComing />);
    const text = panel().textContent ?? "";
    expect(text).toMatch(/There is no date yet\./);
    expect(text).not.toMatch(/(?<!Token-)\b(19|20)\d{2}\b/);
    expect(text).not.toMatch(
      /\b(Q[1-4]|soon|next (week|month|quarter|year)|January|February|March|April|May|June|July|August|September|October|November|December)\b/i,
    );
  });

  it("offers nothing to act on except a link to spot markets", () => {
    render(<MainnetRecurringComing />);
    expect(within(panel()).queryAllByRole("button")).toHaveLength(0);
    expect(within(panel()).queryAllByRole("textbox")).toHaveLength(0);
    const links = within(panel()).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute("href")).toBe(routes.markets);
  });
});

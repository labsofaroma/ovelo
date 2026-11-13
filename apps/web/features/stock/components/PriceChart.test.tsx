// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import PriceChart from "./PriceChart";

afterEach(cleanup);

const closes = [
  { date: "2026-01-02", close: { raw: "1000000", decimals: 4 } },
  { date: "2026-10-20", close: { raw: "1100000", decimals: 4 } },
  { date: "2026-11-12", close: { raw: "1210000", decimals: 4 } },
];

describe("PriceChart island", () => {
  it("defaults to 6M and summarises the observed closes", () => {
    render(<PriceChart closes={closes} symbol="TEST" />);
    expect(screen.getByRole("button", { name: "6M" })).toHaveProperty(
      "ariaPressed",
      "true",
    );
    expect(screen.getByText(/TEST underlying close \$110\.00/)).toBeTruthy();
  });
  it("switches range with the keyboard-operable buttons", async () => {
    render(<PriceChart closes={closes} symbol="TEST" />);
    await userEvent.click(screen.getByRole("button", { name: "1Y" }));
    expect(screen.getByRole("button", { name: "1Y" })).toHaveProperty(
      "ariaPressed",
      "true",
    );
    expect(screen.getByText(/\$100\.00 on 2 Jan 2026/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "1M" }));
    expect(screen.getByText(/\+10\.00%/)).toBeTruthy();
  });
  it("says so when a range has too few closes", () => {
    render(<PriceChart closes={closes.slice(-1)} symbol="TEST" />);
    expect(
      screen.getByText("Not enough observed closes for this range."),
    ).toBeTruthy();
  });
});

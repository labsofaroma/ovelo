// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { onboardingCopy } from "../copy";

vi.mock("../../wallet/ConnectButton", () => ({
  ConnectButton: () => <button type="button">Connect wallet</button>,
}));
const { OnboardingSteps } = await import("./OnboardingSteps");
afterEach(cleanup);

const WALLET = "7e5pxK83ceXb2iWXBizF1U8MdL7C5VcVBBXpDWaYo3x1";
const base = {
  suggestion: { id: "sol-core", name: "Solana Core", tokens: 3 },
  capText: "$50 per purchase",
  paused: false,
  pageUrl: "https://aroma.example/get-started",
};
const funds = (over = {}) => ({
  step: "funds" as const,
  loading: false,
  error: false,
  sol: 10_000_000n,
  usdc: 25_000_000n,
  needed: 6_000_000n,
  ...over,
});

describe("OnboardingSteps", () => {
  it("no wallet: install links and phone links that open this page in the wallet's browser", () => {
    render(
      <OnboardingSteps
        address={null}
        funds={funds({ step: "wallet", sol: null, usdc: null })}
        {...base}
      />,
    );
    expect(
      screen
        .getByRole("link", { name: "Install Phantom" })
        .getAttribute("href"),
    ).toBe("https://phantom.com/download");
    expect(
      screen
        .getByRole("link", { name: "Open in Phantom" })
        .getAttribute("href"),
    ).toBe(
      "https://phantom.app/ul/browse/https%3A%2F%2Faroma.example%2Fget-started?ref=https%3A%2F%2Faroma.example",
    );
    expect(screen.getByRole("link", { name: "Open in Solflare" })).toBeTruthy();
  });

  it("real balances, the SOL needed for the suggested basket, and whether it is enough", () => {
    render(<OnboardingSteps address={WALLET} funds={funds()} {...base} />);
    expect(
      screen.getByText(onboardingCopy.balances("0.0100", "25.00")),
    ).toBeTruthy();
    expect(screen.getByText(/has 3 tokens/)).toBeTruthy();
    expect(screen.getByText(onboardingCopy.solOk)).toBeTruthy();
  });

  it("short of SOL and no USDC: says how much SOL is missing; links to no exchange", () => {
    render(
      <OnboardingSteps
        address={WALLET}
        funds={funds({ sol: 1_000_000n, usdc: 0n })}
        {...base}
      />,
    );
    expect(screen.getByText(onboardingCopy.solShort("0.0050"))).toBeTruthy();
    expect(screen.getByText(onboardingCopy.usdcNone)).toBeTruthy();
    const hrefs = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href") ?? "");
    expect(
      hrefs.filter((h) => /moonpay|coinbase|ramp|transak|binance/i.test(h)),
    ).toEqual([]);
  });

  it("balances unavailable: says so, never a zero", () => {
    render(
      <OnboardingSteps
        address={WALLET}
        funds={funds({ error: true, sol: null, usdc: null })}
        {...base}
      />,
    );
    expect(screen.getByText(onboardingCopy.balancesUnavailable)).toBeTruthy();
  });

  it("the suggestion opens the basket's trade ticket, says why it is shown and that it is not advice", () => {
    render(
      <OnboardingSteps
        address={WALLET}
        funds={funds({ step: "first_buy" })}
        {...base}
      />,
    );
    expect(
      screen
        .getByRole("link", { name: onboardingCopy.open })
        .getAttribute("href"),
    ).toBe("/basket/sol-core");
    expect(screen.getByText(/not a recommendation/)).toBeTruthy();
    expect(screen.queryByText(/%|return|perform/i)).toBeNull();
  });

  it("no basket available: points to Markets", () => {
    render(
      <OnboardingSteps
        address={WALLET}
        funds={funds()}
        {...base}
        suggestion={null}
      />,
    );
    expect(
      screen.getByText(onboardingCopy.suggestionNone, { exact: false }),
    ).toBeTruthy();
  });
});

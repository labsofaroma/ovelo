// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  disclosureLines,
  DISCLOSURE_VERSION,
} from "../../compliance/disclosures";
import type { PlanSummary } from "../schema";
import { ReviewPanel } from "./ReviewPanel";

/**
 * Phase A (COMPLIANCE.md §5): the invest review renders the devnet risk disclosure, and the
 * confirm control exists only INSIDE it, so a plan cannot be signed without it. The persistent
 * devnet label stays.
 */
afterEach(cleanup);

const summary = {
  cluster: "devnet",
  label: "Devnet: test tokens, no real value",
  title: "Create a weekly plan",
  lines: ["10 test USD per week"],
  approval: { text: "Your wallet approves up to 2 installments per period." },
  risk: "Test tokens only.",
} as unknown as PlanSummary;

function show() {
  const onConfirm = vi.fn();
  render(
    <ReviewPanel
      summary={summary}
      state={{ step: "idle" }}
      confirmLabel="Sign and create plan"
      onConfirm={onConfirm}
      onBack={() => {}}
      testId="confirm"
    />,
  );
  return onConfirm;
}

describe("invest ReviewPanel risk disclosure", () => {
  it("wraps the confirm control in the devnet disclosure and keeps the devnet label", () => {
    const onConfirm = show();
    const disclosure = screen.getByRole("region", { name: "Risk disclosure" });
    expect(disclosure.getAttribute("data-disclosure-surface")).toBe(
      "recurring-devnet",
    );
    expect(disclosure.getAttribute("data-disclosure-version")).toBe(
      DISCLOSURE_VERSION,
    );
    for (const line of disclosureLines("recurring-devnet"))
      expect(within(disclosure).getByText(line)).toBeTruthy();
    const confirm = within(disclosure).getByRole("button", {
      name: "Sign and create plan",
    });
    expect(
      screen.getAllByRole("button", { name: "Sign and create plan" }),
    ).toEqual([confirm]);
    confirm.click();
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(screen.getByText("Devnet: test tokens, no real value")).toBeTruthy();
  });

  it("shows no mainnet-only risk lines on a devnet test (no invented claims)", () => {
    show();
    const disclosure = screen.getByRole("region", { name: "Risk disclosure" });
    expect(disclosure.textContent).not.toMatch(/Mainnet transactions/);
    expect(disclosure.textContent).toMatch(/test tokens of no value/);
  });
});

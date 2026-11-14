import { describe, expect, it } from "vitest";
import {
  buildCreateRequest,
  percentToBps,
  periodChoices,
  type WizardBasket,
  type WizardState,
} from "./wizard";

const OWNER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const A = "So11111111111111111111111111111111111111112";
const B = "11111111111111111111111111111112";
const baskets: WizardBasket[] = [
  {
    id: "ok",
    name: "OK",
    kind: "curated",
    available: true,
    missing: [],
    outputs: [{ mint: A, symbol: "AAPL", weightBps: 10_000 }],
  },
  {
    id: "no",
    name: "No",
    kind: "curated",
    available: false,
    missing: ["TSLA", "META"],
    outputs: [],
  },
];
const base: WizardState = {
  mode: "assets",
  basketId: null,
  weights: { [A]: "50", [B]: "50" },
  amount: "10",
  periodSeconds: 604_800,
  periods: "4",
};
const opts = { decimals: 6, maxInstallmentRaw: 500_000_000n, baskets };

describe("plan wizard rules", () => {
  it("builds the exact request: raw amount, weights in bps", () => {
    const result = buildCreateRequest(
      OWNER,
      { ...base, weights: { [A]: "33.34", [B]: "66.66" } },
      opts,
    );
    expect(result).toEqual({
      ok: true,
      request: {
        owner: OWNER,
        fundingAmount: "10000000",
        periodSeconds: 604_800,
        periods: 4,
        selection: {
          kind: "assets",
          outputs: [
            { mint: A, weightBps: 3334 },
            { mint: B, weightBps: 6666 },
          ],
        },
      },
    });
  });

  it("weights must sum to exactly 100% with at most two decimals", () => {
    expect(
      buildCreateRequest(
        OWNER,
        { ...base, weights: { [A]: "50", [B]: "49.99" } },
        opts,
      ),
    ).toMatchObject({
      ok: false,
      errors: { weights: "Weights must add up to exactly 100%." },
    });
    expect(
      buildCreateRequest(
        OWNER,
        { ...base, weights: { [A]: "50.001", [B]: "49.999" } },
        opts,
      ),
    ).toMatchObject({
      ok: false,
      errors: { weights: expect.stringMatching(/two decimals/) },
    });
    expect(
      buildCreateRequest(OWNER, { ...base, weights: {} }, opts),
    ).toMatchObject({ ok: false, errors: { selection: expect.any(String) } });
    expect(percentToBps("100")).toBe(10_000);
    expect(percentToBps("100.01")).toBeNull();
  });

  it("the schedule must fit in 366 days; amounts are positive and under the cap", () => {
    expect(
      buildCreateRequest(
        OWNER,
        { ...base, periodSeconds: 2_592_000, periods: "13" },
        opts,
      ),
    ).toMatchObject({
      ok: false,
      errors: { periods: "The whole schedule must fit in 366 days." },
    });
    expect(
      buildCreateRequest(
        OWNER,
        { ...base, periodSeconds: 2_592_000, periods: "12" },
        opts,
      ).ok,
    ).toBe(true);
    expect(
      buildCreateRequest(OWNER, { ...base, amount: "0" }, opts),
    ).toMatchObject({ ok: false, errors: { amount: expect.any(String) } });
    expect(
      buildCreateRequest(OWNER, { ...base, amount: "500.000001" }, opts),
    ).toMatchObject({
      ok: false,
      errors: { amount: expect.stringMatching(/limit/) },
    });
    expect(
      buildCreateRequest(OWNER, { ...base, periods: "1.5" }, opts),
    ).toMatchObject({ ok: false });
  });

  it("baskets: available ones build; unavailable ones say what is missing", () => {
    expect(
      buildCreateRequest(
        OWNER,
        { ...base, mode: "basket", basketId: "ok" },
        opts,
      ),
    ).toMatchObject({
      ok: true,
      request: { selection: { kind: "basket", basketId: "ok" } },
    });
    expect(
      buildCreateRequest(
        OWNER,
        { ...base, mode: "basket", basketId: "no" },
        opts,
      ),
    ).toMatchObject({
      ok: false,
      errors: { selection: "Not on devnet: TSLA, META." },
    });
  });

  it("devnet offers only real cadences (never 'monthly'); localnet adds a short test period", () => {
    expect(periodChoices("devnet").map((c) => c.label)).toEqual([
      "Every day",
      "Every week",
      "Every 30 days",
    ]);
    expect(periodChoices("localnet")[0]).toEqual({
      seconds: 15,
      label: "Every 15 seconds (local test)",
    });
    expect(JSON.stringify(periodChoices("localnet"))).not.toMatch(/month/i);
  });

  it("a devnet test build adds the 15-minute test period; a real devnet build never does", () => {
    expect(periodChoices("devnet", false)).toEqual(periodChoices("devnet"));
    expect(periodChoices("devnet", true)[0]).toEqual({
      seconds: 900,
      label: "Every 15 minutes (devnet test build)",
    });
    expect(periodChoices("devnet", true).slice(1)).toEqual(
      periodChoices("devnet"),
    );
  });
});

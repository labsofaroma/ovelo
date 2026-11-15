// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const DOMAIN = "aroma.example";
let fetchMock: ReturnType<typeof vi.fn>;
async function load(consent: boolean | null, options: { dnt?: boolean } = {}) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_PLAUSIBLE_DOMAIN", DOMAIN);
  localStorage.clear();
  if (consent !== null)
    localStorage.setItem(
      "aroma.privacy.v1",
      JSON.stringify({ analytics: consent, expiresAt: Date.now() + 1e9 }),
    );
  Object.defineProperty(window, "location", {
    value: { hostname: DOMAIN },
    configurable: true,
  });
  Object.defineProperty(navigator, "doNotTrack", {
    value: options.dnt ? "1" : "0",
    configurable: true,
  });
  fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
  vi.stubGlobal("fetch", fetchMock);
  return import("./funnel");
}
const sent = () =>
  fetchMock.mock.calls.map(([, init]) =>
    JSON.parse((init as RequestInit).body as string),
  );

beforeEach(() => vi.useRealTimers());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("onboarding funnel (consent-gated)", () => {
  it.each([
    ["no choice", null, false],
    ["declined", false, false],
    ["consented but Do-Not-Track", true, true],
  ])("sends nothing and stores nothing: %s", async (_name, consent, dnt) => {
    const funnel = await load(consent as boolean | null, {
      dnt: dnt as boolean,
    });
    funnel.stepViewed("wallet");
    funnel.walletConnected();
    funnel.firstQuote("basket");
    funnel.buyConfirmed("basket");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("aroma.onboarding.v1")).toBeNull();
  });

  it("with consent: the four events, no wallet address, and the time to first basket buy as a bucket", async () => {
    const funnel = await load(true);
    funnel.stepViewed("wallet", 1_000_000);
    funnel.walletConnected(1_010_000);
    funnel.firstQuote("basket");
    funnel.firstQuote("basket");
    funnel.buyConfirmed("basket", 1_000_000 + 95_000);
    funnel.buyConfirmed("basket", 1_000_000 + 200_000);
    const events = sent();
    expect(events.map((e) => e.name)).toEqual([
      "onboarding_step_viewed",
      "wallet_connected",
      "first_quote",
      "first_buy_confirmed",
    ]);
    expect(events[3].props).toEqual({
      target: "basket",
      time_to_first_basket: "1_2m",
    });
    expect(JSON.stringify(events)).not.toMatch(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
    for (const e of events)
      expect(e.url).toMatch(/^https:\/\/aroma\.example\/[a-z-/]+$/);
  });

  it("a first stock buy, then the first basket buy still reports the basket timing once", async () => {
    const funnel = await load(true);
    funnel.stepViewed("funds", 0);
    funnel.buyConfirmed("spot", 30_000);
    funnel.buyConfirmed("basket", 400_000);
    funnel.buyConfirmed("basket", 500_000);
    expect(sent().map((e) => e.props)).toEqual([
      { step: "funds" },
      { target: "spot" },
      { target: "basket", time_to_first_basket: "5_15m" },
    ]);
  });

  it("buckets", async () => {
    const { durationBucket } = await load(true);
    expect([59, 60, 119, 120, 299, 300, 899, 900].map(durationBucket)).toEqual([
      "under_1m",
      "1_2m",
      "1_2m",
      "2_5m",
      "2_5m",
      "5_15m",
      "5_15m",
      "over_15m",
    ]);
  });
});

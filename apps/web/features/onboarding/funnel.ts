"use client";

import { analyticsAllowed, trackEvent } from "../shared/analytics";

/**
 * Onboarding funnel events (M11 Step 3), consent-gated (shared/analytics.ts). The only state is a
 * start time and two flags in localStorage, written only after consent, so "first" quote and
 * "first" buy are per browser. No wallet address, amount or signature is ever sent.
 *
 * Time to first basket buy: seconds from the first onboarding view (or first wallet connection)
 * to the first confirmed basket buy in this browser, sent as a coarse bucket.
 */
const KEY = "ovelo.onboarding.v1";
type Stored = {
  startedAt?: number;
  quoted?: boolean;
  bought?: boolean;
  basketBought?: boolean;
};

const read = (): Stored => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Stored;
  } catch {
    return {};
  }
};
const write = (next: Stored) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* blocked storage: events still send, "first" just cannot be remembered */
  }
};

export const ONBOARDING_STEPS = ["wallet", "funds", "first_buy"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** Coarse bucket for the time to first basket buy (ROADMAP §4 target: under 2 minutes). */
export function durationBucket(seconds: number): string {
  if (seconds < 60) return "under_1m";
  if (seconds < 120) return "1_2m";
  if (seconds < 300) return "2_5m";
  if (seconds < 900) return "5_15m";
  return "over_15m";
}

function start(now: number): Stored {
  const stored = read();
  if (stored.startedAt === undefined) {
    stored.startedAt = now;
    write(stored);
  }
  return stored;
}

export function stepViewed(step: OnboardingStep, now = Date.now()): void {
  if (!analyticsAllowed()) return;
  start(now);
  trackEvent("onboarding_step_viewed", "/get-started", { step });
}

export function walletConnected(now = Date.now()): void {
  if (!analyticsAllowed()) return;
  start(now);
  trackEvent("wallet_connected", "/wallet");
}

export function firstQuote(target: "spot" | "basket"): void {
  if (!analyticsAllowed()) return;
  const stored = read();
  if (stored.quoted) return;
  write({ ...stored, quoted: true });
  trackEvent("first_quote", "/trade", { target });
}

export function buyConfirmed(
  target: "spot" | "basket",
  now = Date.now(),
): void {
  if (!analyticsAllowed()) return;
  const stored = read();
  const props: Record<string, string> = { target };
  if (
    target === "basket" &&
    !stored.basketBought &&
    stored.startedAt !== undefined
  )
    props.time_to_first_basket = durationBucket(
      Math.floor((now - stored.startedAt) / 1000),
    );
  if (stored.bought && !props.time_to_first_basket) return;
  write({
    ...stored,
    bought: true,
    basketBought: stored.basketBought || target === "basket",
  });
  trackEvent("first_buy_confirmed", "/trade", props);
}

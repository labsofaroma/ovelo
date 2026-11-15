import "server-only";
import {
  classifyJupiterRouteError,
  ROUTE_ACCOUNT_TIERS,
} from "@/lib/sdk/baskets/route-health";
import { testSwitchesAllowed } from "@/server/env.schema";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";

/**
 * Jupiter Swap API v2 `/build` (ported from the prototype's jupiter-build.ts): a per-process key pool
 * with pacing and 429 cooldowns, and account-tier widening ONLY when Jupiter says "no route".
 * Auth failures, rate limits and malformed instructions never widen routing.
 *
 * Production needs JUPITER_API_KEY (comma-separated keys rotate). E2E builds may point at a
 * loopback stand-in with recorded routes (OVELO_V1_TEST_JUPITER_URL, test switches only).
 */

type KeyState = { key: string; nextRequestAt: number; cooldownUntil: number };
let pool: KeyState[] | null = null;

export function jupiterBase(): string {
  const test = process.env.OVELO_V1_TEST_JUPITER_URL?.trim();
  if (
    test &&
    /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(test) &&
    testSwitchesAllowed(process.env)
  )
    return test.replace(/\/$/, "");
  return "https://api.jup.ag";
}

function keys(): KeyState[] {
  if (pool) return pool;
  const raw = process.env.JUPITER_API_KEY ?? "";
  pool = [
    ...new Set(
      raw
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
    ),
  ].map((key) => ({ key, nextRequestAt: 0, cooldownUntil: 0 }));
  return pool;
}

export function resetJupiterPoolForTests(): void {
  pool = null;
}

async function acquire(states: KeyState[]): Promise<KeyState | null> {
  if (!states.length) return null;
  const now = Date.now();
  const ready = states.filter((k) => k.cooldownUntil <= now);
  const candidates = (ready.length ? ready : states).sort(
    (a, b) =>
      Math.max(a.nextRequestAt, a.cooldownUntil) -
      Math.max(b.nextRequestAt, b.cooldownUntil),
  );
  const selected = candidates[0]!;
  const slot = Math.max(now, selected.nextRequestAt, selected.cooldownUntil);
  if (slot - now > 15_000)
    throw new AppError("RATE_LIMITED", {
      detail: "all Jupiter keys are cooling down",
    });
  selected.nextRequestAt = slot + 1250;
  if (slot > now)
    await new Promise((resolve) => setTimeout(resolve, slot - now));
  return selected;
}

async function fetchOnce(params: URLSearchParams): Promise<Response> {
  const base = jupiterBase();
  const local = base !== "https://api.jup.ag";
  const states = local ? [] : keys();
  if (!states.length && !local && process.env.NODE_ENV === "production")
    throw new AppError("TRADING_UNAVAILABLE", {
      detail: "JUPITER_API_KEY is not configured",
    });
  const attempts = Math.max(1, Math.min(states.length * 2, 4));
  for (let attempt = 0; attempt < attempts; attempt++) {
    const state = await acquire(states);
    let response: Response;
    try {
      response = await fetch(`${base}/swap/v2/build?${params}`, {
        headers: state ? { "x-api-key": state.key } : {},
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
    } catch (cause) {
      throw new AppError("UPSTREAM_UNAVAILABLE", {
        detail: "Jupiter build transport failed",
        cause,
      });
    }
    if (response.status !== 429) return response;
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    const retry = Number(response.headers.get("retry-after") ?? 5);
    if (state)
      state.cooldownUntil =
        Date.now() +
        (reset
          ? Math.max(2000, reset * 1000 - Date.now() + 250)
          : retry * 1000);
    logger.warn({ attempt }, "Jupiter build rate limited");
    if (!state) break;
  }
  throw new AppError("RATE_LIMITED", {
    publicMessage:
      "The routing provider is limiting requests. Wait a moment before requesting a new quote.",
    detail: "Jupiter build 429",
  });
}

/** Build, widening maxAccounts through ROUTE_ACCOUNT_TIERS only on a "no route" answer. */
export async function fetchJupiterBuild(
  params: URLSearchParams,
): Promise<Response> {
  let response: Response | undefined;
  for (const tier of ROUTE_ACCOUNT_TIERS) {
    const request = new URLSearchParams(params);
    request.set("maxAccounts", String(tier));
    response = await fetchOnce(request);
    if (response.ok) return response;
    const error = await response
      .clone()
      .json()
      .catch(() => null);
    if (classifyJupiterRouteError(response.status, error) !== "no-route")
      return response;
  }
  return response!;
}

import "server-only";
import type { CheckStatus, Probe } from "./health";

/**
 * Market-data provider probes for GET /api/v1/health (AUDIT M-7, M4). Facts only: status, whether
 * a key is configured, the age of the newest observation. Never a hostname or provider error text.
 */

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
/** Pyth SOL/USD price feed id (a crypto feed that publishes around the clock). */
export const PYTH_SOL_USD =
  "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
export const PYTH_STALE_SECONDS = 120;

type Fetcher = typeof fetch;

/** Jupiter Price v3 answers for USDC. Keyless is "degraded": it works but is rate-limited. */
export function jupiterProbe(fetcher: Fetcher = fetch): Probe {
  return async () => {
    const key = process.env.JUPITER_API_KEY?.split(",")[0]?.trim();
    const base = key ? "https://api.jup.ag" : "https://lite-api.jup.ag";
    const response = await fetcher(`${base}/price/v3?ids=${USDC}`, {
      headers: key ? { "x-api-key": key } : {},
      cache: "no-store",
    });
    if (!response.ok)
      return {
        status: response.status === 429 ? "degraded" : "fail",
        keyed: Boolean(key),
        httpStatus: response.status,
      };
    const body = (await response.json().catch(() => null)) as Record<
      string,
      { usdPrice?: unknown } | undefined
    > | null;
    const priced = typeof body?.[USDC]?.usdPrice === "number";
    const status: CheckStatus = !priced ? "fail" : key ? "ok" : "degraded";
    return { status, keyed: Boolean(key) };
  };
}

/** Pyth Hermes (needs PYTH_API_KEY) returns a fresh SOL/USD update; an old one is "degraded". */
export function pythProbe(
  fetcher: Fetcher = fetch,
  now: () => number = Date.now,
): Probe {
  return async () => {
    const key = process.env.PYTH_API_KEY?.trim();
    // Hermes answers 401 without a key. Pyth is an optional reference source (PYTH_API_KEY is not
    // required for v1), so an unconfigured Pyth is "skipped", never a reason to report "down".
    if (!key) return { status: "skipped", keyed: false };
    const response = await fetcher(
      `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${PYTH_SOL_USD}&parsed=true`,
      { headers: key ? { "x-api-key": key } : {}, cache: "no-store" },
    );
    if (!response.ok) return { status: "fail", httpStatus: response.status };
    const body = (await response.json().catch(() => null)) as {
      parsed?: { price?: { publish_time?: unknown } }[];
    } | null;
    const published = body?.parsed?.[0]?.price?.publish_time;
    if (typeof published !== "number") return { status: "fail" };
    const ageSeconds = Math.max(0, Math.round(now() / 1000 - published));
    return {
      status: ageSeconds > PYTH_STALE_SECONDS ? "degraded" : "ok",
      ageSeconds,
    };
  };
}

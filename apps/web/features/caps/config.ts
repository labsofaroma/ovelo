/**
 * Per-trade and per-day caps (REWRITE-PLAN §7.3 W3). Pure. Raw USDC units (6 decimals), parsed to
 * `bigint` (AGENTS.md rule 5: never floats). The caps apply whether or not the beta gate is on.
 *
 * - Set: used as given (boot validates: > 0, within u64, daily ≥ per-trade).
 * - Unset outside production: the beta defaults, $50 per trade and $200 per wallet per UTC day.
 * - Unset, 0 or unreadable in production (`NODE_ENV` or `VERCEL_ENV` production): refused, so
 *   every capped request fails CLOSED (TRADE_CAP_UNAVAILABLE) rather than trading uncapped.
 */
type Env = Record<string, string | undefined>;

export const USDC_DECIMALS = 6;
export const BETA_DEFAULT_TRADE_RAW = 50_000_000n;
export const BETA_DEFAULT_DAILY_RAW = 200_000_000n;
const U64_MAX = 2n ** 64n - 1n;

export type CapsConfig = { perTrade: bigint; daily: bigint };

export class CapsConfigError extends Error {
  constructor(readonly variables: string[]) {
    super(`invalid trade caps: ${variables.join(", ")}`);
    this.name = "CapsConfigError";
  }
}

function parse(value: string | undefined): bigint | null | "invalid" {
  const text = value?.trim();
  if (!text) return null;
  if (!/^[1-9]\d{0,19}$/.test(text)) return "invalid";
  const parsed = BigInt(text);
  return parsed <= U64_MAX ? parsed : "invalid";
}

export function capsConfig(env: Env): CapsConfig {
  const production =
    env.NODE_ENV?.trim() === "production" ||
    env.VERCEL_ENV?.trim() === "production";
  const trade = parse(env.AROMA_MAX_TRADE_USDC_RAW);
  const daily = parse(env.AROMA_MAX_DAILY_USDC_RAW);
  const bad: string[] = [];
  if (trade === "invalid" || (trade === null && production))
    bad.push("AROMA_MAX_TRADE_USDC_RAW");
  if (daily === "invalid" || (daily === null && production))
    bad.push("AROMA_MAX_DAILY_USDC_RAW");
  if (bad.length) throw new CapsConfigError(bad);
  const perTrade = (trade as bigint | null) ?? BETA_DEFAULT_TRADE_RAW;
  const perDay = (daily as bigint | null) ?? BETA_DEFAULT_DAILY_RAW;
  if (perDay < perTrade)
    throw new CapsConfigError(["AROMA_MAX_DAILY_USDC_RAW"]);
  return { perTrade, daily: perDay };
}

/** The UTC calendar day an amount counts against ("YYYY-MM-DD"). */
export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** "$50" / "$12.50" from raw USDC units, for messages. Exact (bigint), never rounded up. */
export function usd(raw: bigint): string {
  const whole = raw / 1_000_000n;
  const cents = (raw % 1_000_000n) / 10_000n;
  return cents === 0n
    ? `$${whole}`
    : `$${whole}.${cents.toString().padStart(2, "0")}`;
}

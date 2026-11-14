/** Exact formatting of raw integer amounts and chain times (no floats, AGENTS.md rule 5). */

export function formatRaw(raw: bigint, decimals: number): string {
  const negative = raw < 0n;
  const value = negative ? -raw : raw;
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;
}

/** "14 Nov 2026, 17:05 UTC" from unix seconds. */
export function formatChainTime(seconds: bigint): string {
  const date = new Date(Number(seconds) * 1000);
  const day = date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const time = date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
  return `${day}, ${time} UTC`;
}

const UNITS: [bigint, string][] = [
  [2_592_000n, "30 days"],
  [604_800n, "week"],
  [86_400n, "day"],
  [3_600n, "hour"],
  [60n, "minute"],
  [1n, "second"],
];

/** "every week", "every 30 days", "every 15 seconds". Never "monthly" (PRODUCT.md). */
export function formatPeriod(seconds: bigint): string {
  for (const [size, unit] of UNITS)
    if (seconds % size === 0n) {
      const n = seconds / size;
      if (unit === "30 days")
        return n === 1n ? "every 30 days" : `every ${n * 30n} days`;
      return n === 1n ? `every ${unit}` : `every ${n} ${unit}s`;
    }
  return `every ${seconds} seconds`;
}

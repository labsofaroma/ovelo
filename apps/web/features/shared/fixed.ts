import { z } from "zod";
import { formatSignedUnits, formatUnits } from "@ovelo/ui/format";

/**
 * A display number as a raw integer plus decimals (AGENTS.md rule 5). JSON-safe, so it can live in
 * the Next data cache; it becomes a `bigint` only to be formatted. Upstream providers publish prices
 * as JSON numbers: they are converted ONCE, here at the boundary, and never used for arithmetic that
 * gets signed. Nothing in M3 signs anything.
 */
export const fixedSchema = z.object({
  raw: z.string().regex(/^-?\d+$/),
  decimals: z.number().int().min(0).max(18),
});
export type Fixed = z.infer<typeof fixedSchema>;

/** Above this, `toFixed` switches to exponent notation. No market figure comes close. */
const MAX_ABS = 1e20;

/** `(1.5, 6)` → `{ raw: "1500000", decimals: 6 }`. Null, NaN, ±Infinity or absurd values → null. */
export function fixedFromNumber(
  value: number | null | undefined,
  decimals: number,
): Fixed | null {
  if (value == null || !Number.isFinite(value) || Math.abs(value) >= MAX_ABS)
    return null;
  const text = value.toFixed(decimals);
  const negative = text.startsWith("-");
  const digits = (negative ? text.slice(1) : text)
    .replace(".", "")
    .replace(/^0+(?=\d)/, "");
  const raw = negative && /[1-9]/.test(digits) ? `-${digits}` : digits;
  return { raw, decimals };
}

export function toBigInt(value: Fixed): bigint {
  return BigInt(value.raw);
}

/** Strictly positive. A price of 0 means "no price", never a free asset. */
export function isPositive(value: Fixed | null): value is Fixed {
  return value !== null && toBigInt(value) > 0n;
}

function split(value: Fixed): { abs: bigint; sign: string } {
  const big = toBigInt(value);
  return { abs: big < 0n ? -big : big, sign: big < 0n ? "−" : "" };
}

/** "$1,234.56". Sub-dollar prices keep up to 6 digits so they never round to "$0.00". */
export function formatUsd(value: Fixed): string {
  const { abs, sign } = split(value);
  const digits =
    abs >= 10n ** BigInt(value.decimals) ? 2 : Math.min(value.decimals, 6);
  const { text } = formatUnits(abs, value.decimals, { fractionDigits: digits });
  return `${sign}$${text}`;
}

const COMPACT = [
  { shift: 12, suffix: "T" },
  { shift: 9, suffix: "B" },
  { shift: 6, suffix: "M" },
  { shift: 3, suffix: "K" },
] as const;

/** "$1.23B" for volume, liquidity and market cap. Exact integer scaling, no float math. */
export function formatCompactUsd(value: Fixed): string {
  const { abs, sign } = split(value);
  for (const { shift, suffix } of COMPACT) {
    if (abs >= 10n ** BigInt(value.decimals + shift)) {
      const { text } = formatUnits(abs, value.decimals + shift, {
        fractionDigits: 2,
      });
      return `${sign}$${text}${suffix}`;
    }
  }
  return formatUsd(value);
}

/** "+1.23%", "−0.40%" or "0.00%". */
export function formatPercent(value: Fixed, fractionDigits = 2): string {
  const { signed } = formatSignedUnits(toBigInt(value), value.decimals, {
    fractionDigits,
  });
  return `${signed}%`;
}

/** Plain grouped number with a sign: "1,234.5", "−0.42". */
export function formatUnitsText(value: Fixed, fractionDigits = 2): string {
  const { abs, sign } = split(value);
  return `${sign}${formatUnits(abs, value.decimals, { fractionDigits }).text}`;
}

/** Integer basis points as a percent: 3334 → "33.34%". */
export function formatBps(bps: number): string {
  return `${formatUnits(BigInt(bps), 2, { fractionDigits: 2 }).text}%`;
}

/** Props for the `@ovelo/ui` `Change` component. */
export function changeProp(
  value: Fixed | null,
): { value: bigint; decimals: number } | null {
  return value ? { value: toBigInt(value), decimals: value.decimals } : null;
}

/** "1 asset", "3 assets". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

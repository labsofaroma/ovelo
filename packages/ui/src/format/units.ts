/**
 * Display formatting for raw integer amounts. Input is always `bigint` plus a `decimals`
 * count; no step goes through a JS number, so large and tiny values stay exact. These
 * helpers are for display only: never parse their output back into an amount to sign.
 */

export interface FormatUnitsOptions {
  /** Fixed number of fraction digits in the output. Default 2. */
  fractionDigits?: number;
  /** Insert "," between thousands. Default true. */
  grouping?: boolean;
}

export interface FormattedUnits {
  /** Unsigned text, e.g. "1,234.50". */
  text: string;
  /** Sign of the value AFTER rounding to the displayed digits: -1, 0 or 1. */
  sign: -1 | 0 | 1;
}

const MAX_DECIMALS = 36;

function assertInt(name: string, value: number, max: number): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new RangeError(`${name} must be an integer between 0 and ${max}`);
  }
}

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Formats `value / 10^decimals` with `fractionDigits` digits, rounding half away from zero.
 * A negative value that rounds to zero reports `sign: 0` (there is no "negative zero").
 */
export function formatUnits(
  value: bigint,
  decimals: number,
  { fractionDigits = 2, grouping = true }: FormatUnitsOptions = {},
): FormattedUnits {
  assertInt("decimals", decimals, MAX_DECIMALS);
  assertInt("fractionDigits", fractionDigits, MAX_DECIMALS);

  const negative = value < 0n;
  let magnitude = negative ? -value : value;

  if (fractionDigits < decimals) {
    const divisor = 10n ** BigInt(decimals - fractionDigits);
    const remainder = magnitude % divisor;
    magnitude /= divisor;
    if (remainder * 2n >= divisor) magnitude += 1n;
  } else if (fractionDigits > decimals) {
    magnitude *= 10n ** BigInt(fractionDigits - decimals);
  }

  const padded = magnitude.toString().padStart(fractionDigits + 1, "0");
  const whole = padded.slice(0, padded.length - fractionDigits);
  const fraction = padded.slice(padded.length - fractionDigits);
  const text = `${grouping ? group(whole) : whole}${fractionDigits > 0 ? `.${fraction}` : ""}`;
  const sign = magnitude === 0n ? 0 : negative ? -1 : 1;
  return { text, sign };
}

/** Typographic minus (U+2212): sits level with "+" and is read as "minus" by screen readers. */
export const MINUS = "−";

/** Like `formatUnits` but with an explicit sign: "+1.23", "−1.23", or "0.00" (no sign). */
export function formatSignedUnits(
  value: bigint,
  decimals: number,
  options?: FormatUnitsOptions,
): FormattedUnits & { signed: string } {
  const formatted = formatUnits(value, decimals, options);
  const prefix = formatted.sign > 0 ? "+" : formatted.sign < 0 ? MINUS : "";
  return { ...formatted, signed: `${prefix}${formatted.text}` };
}

/**
 * Token amount conversion between human decimal strings and raw integer units.
 * String and BigInt only: no floating point ever touches an amount that may be signed.
 */

const U64_MAX = BigInt("18446744073709551615");

/** Parse without floating point rounding or accepting exponent / negative notation. */
export function toTokenAmount(amount: string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18)
    throw new Error("Unsupported token precision.");
  const trimmed = amount.trim();
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(trimmed))
    throw new Error("Enter a positive decimal amount.");
  const [whole = "", fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals)
    throw new Error(`This token supports up to ${decimals} decimal places.`);
  const value = BigInt(whole + fraction.padEnd(decimals, "0"));
  if (value <= BigInt(0) || value > U64_MAX)
    throw new Error("Amount is outside the supported range.");
  return value.toString();
}

/** Raw integer units to a trimmed decimal string ("1000000", 6 -> "1"). */
export function fromTokenAmount(rawAmount: string, decimals: number): string {
  if (
    !/^\d+$/.test(rawAmount) ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 255
  )
    throw new Error("Invalid token amount.");
  if (decimals === 0) return rawAmount;
  const value = rawAmount.padStart(decimals + 1, "0");
  return `${value.slice(0, -decimals)}.${value.slice(-decimals)}`.replace(
    /\.?0+$/,
    "",
  );
}

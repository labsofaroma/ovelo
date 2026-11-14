/**
 * Exact amount handling for the invest UI (AGENTS.md rule 5): decimal text ⇄ raw integer units
 * with bigint only, and oracle prices (`price × 10^expo`) rendered from their integer parts.
 */

/** "12.5" with 6 decimals → 12500000n. Null for anything that is not a plain positive decimal. */
export function parseDecimalToRaw(
  text: string,
  decimals: number,
): bigint | null {
  const value = text.trim().replaceAll(",", "");
  const match = /^(\d{1,20})(?:\.(\d*))?$/.exec(value);
  if (!match) return null;
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) return null;
  return (
    BigInt(match[1]!) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0") || "0")
  );
}

/** 12500000n with 6 decimals → "12.5" (no grouping; for inputs and round trips). */
export function rawToDecimal(raw: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const fraction = (raw % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return `${raw / scale}${fraction ? `.${fraction}` : ""}`;
}

/** An oracle price `price × 10^expo` as exact decimal text, e.g. (23142000000, -8) → "231.42". */
export function oraclePriceText(price: string, expo: number): string {
  const negative = price.startsWith("-");
  const digits = (negative ? price.slice(1) : price).replace(/^0+(?=\d)/, "");
  let text: string;
  if (expo >= 0) text = digits === "0" ? "0" : digits + "0".repeat(expo);
  else {
    const places = -expo;
    const padded = digits.padStart(places + 1, "0");
    const whole = padded.slice(0, padded.length - places);
    const fraction = padded.slice(padded.length - places).replace(/0+$/, "");
    text = fraction ? `${whole}.${fraction}` : whole;
  }
  return `${negative ? "-" : ""}${text}`;
}

export function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

/** Solana Explorer link for a signature; localnet uses a custom cluster URL. */
export function explorerUrl(
  signature: string,
  cluster: "devnet" | "localnet",
  rpcUrl: string,
): string {
  const base = `https://explorer.solana.com/tx/${encodeURIComponent(signature)}`;
  return cluster === "devnet"
    ? `${base}?cluster=devnet`
    : `${base}?cluster=custom&customUrl=${encodeURIComponent(rpcUrl)}`;
}

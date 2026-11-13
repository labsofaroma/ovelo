/** Defensive readers for untrusted provider JSON: anything unexpected becomes null/empty. */

export type Row = Record<string, unknown>;
export function row(value: unknown): Row {
  return value !== null && typeof value === "object" ? (value as Row) : {};
}
export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
export function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
export function positive(value: unknown): number | null {
  const result = number(value);
  return result !== null && result > 0 ? result : null;
}
export function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}
export function validMint(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}
export function logo(value: unknown): string | null {
  const url = string(value);
  return url.startsWith("https://") ? url : null;
}
export function timestamp(value: unknown): string | null {
  const valueString = string(value);
  return valueString && Number.isFinite(Date.parse(valueString))
    ? valueString
    : null;
}
export function nonnegative(value: unknown): number | null {
  const result = number(value);
  return result !== null && result >= 0 ? result : null;
}

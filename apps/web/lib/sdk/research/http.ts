import type { RequestOptions } from "./types";

export type Row = Record<string, unknown>;
export const row = (value: unknown): Row =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : {};
export const list = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
export const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";
export const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
export const positive = (value: unknown): number | null => {
  const n = finite(value);
  return n !== null && n > 0 ? n : null;
};
export const safeUrl = (value: unknown): string | null => {
  try {
    const url = new URL(text(value));
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
};
export const dateFromSeconds = (value: unknown): string | null => {
  const seconds = finite(value);
  if (seconds === null || seconds <= 0 || seconds > 8.64e12) return null;
  return new Date(seconds * 1000).toISOString();
};

export async function request(
  url: string,
  options: RequestOptions,
  format: "json" | "text" = "json",
): Promise<unknown> {
  const response = await (options.fetcher ?? fetch)(url, {
    headers: {
      Accept:
        format === "json"
          ? "application/json"
          : "application/rss+xml, application/xml",
      "User-Agent": "Aroma Research",
    },
    signal: options.signal ?? AbortSignal.timeout(8_000),
  });
  if (!response.ok)
    throw new Error(`Research provider returned HTTP ${response.status}`);
  const body = await response.text();
  if (body.length > 2_000_000)
    throw new Error("Research response exceeded its size limit");
  return format === "json" ? (JSON.parse(body) as unknown) : body;
}

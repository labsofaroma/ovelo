import type { MarketOptions } from "./types";

export const CATALOG_TTL_MS = 10 * 60_000;

export function requestSignal(options: MarketOptions): AbortSignal {
  const timeout = AbortSignal.timeout(15_000);
  return options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
}

async function waitForRateLimit(
  delayMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw new Error("Market request deadline exceeded");
  await new Promise<void>((resolve, reject) => {
    const aborted = (): void => {
      clearTimeout(timer);
      reject(new Error("Market request deadline exceeded"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", aborted);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", aborted, { once: true });
  });
}

/** A non-2xx provider response. `status` lets callers tell rate limiting (429) from an outage. */
export class MarketHttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Market provider returned HTTP ${status}`);
    this.name = "MarketHttpError";
    this.status = status;
  }
}

export function isRateLimited(error: unknown): boolean {
  return error instanceof MarketHttpError && error.status === 429;
}

export function resolveJupiterApiKey(raw?: string): string | undefined {
  if (!raw) return undefined;
  return raw
    .split(",")
    .map((k) => k.trim())
    .find(Boolean);
}

export async function request(
  url: string,
  options: MarketOptions,
): Promise<unknown> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const jupiterApiKey = resolveJupiterApiKey(options.jupiterApiKey);
  if (url.startsWith("https://api.jup.ag/") && jupiterApiKey)
    headers["x-api-key"] = jupiterApiKey;
  let response = await (options.fetcher ?? fetch)(url, {
    headers,
    signal: requestSignal(options),
    cache: "no-store",
  });
  // Jupiter shares its short rate-limit window across Tokens and Price requests.
  // Respect the actual reset; retrying a full catalog after one second loses whole batches.
  if (response.status === 429) {
    const retrySeconds = Number(response.headers.get("retry-after"));
    const resetSeconds = Number(response.headers.get("x-ratelimit-reset"));
    const resetDelay =
      Number.isFinite(resetSeconds) && resetSeconds > 0
        ? resetSeconds * 1000 - Date.now() + 100
        : 0;
    const requestedDelay =
      Number.isFinite(retrySeconds) && retrySeconds > 0
        ? retrySeconds * 1000
        : resetDelay > 0
          ? resetDelay
          : 1_000;
    const delayMs = Math.min(Math.max(requestedDelay, 100), 15_000);
    await waitForRateLimit(delayMs, options.signal);
    response = await (options.fetcher ?? fetch)(url, {
      headers,
      signal: requestSignal(options),
      cache: "no-store",
    });
  }
  if (!response.ok) throw new MarketHttpError(response.status);
  return response.json() as Promise<unknown>;
}

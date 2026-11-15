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

/**
 * Process-wide Jupiter quota gate. Jupiter reports its window on every response
 * (`x-ratelimit-remaining`, `x-ratelimit-reset` in epoch seconds). When the window is spent,
 * every caller in the process (markets refresh, stock pages, quotes) waits for the reset instead
 * of spending requests on 429s. Kept on globalThis so separate route bundles share it.
 */
type JupiterGate = { until: number };
const GATE_KEY = "__oveloJupiterGate";
function jupiterGate(): JupiterGate {
  const slot = globalThis as unknown as Record<string, JupiterGate | undefined>;
  return (slot[GATE_KEY] ??= { until: 0 });
}
const isJupiter = (url: string): boolean =>
  /^https:\/\/(api|lite-api)\.jup\.ag\//.test(url);

async function waitForJupiterWindow(signal?: AbortSignal): Promise<void> {
  const delay = jupiterGate().until - Date.now();
  if (delay > 0) await waitForRateLimit(Math.min(delay, 15_000), signal);
}

function noteJupiterWindow(response: Response): void {
  const remaining = Number(response.headers.get("x-ratelimit-remaining"));
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  const spent = response.status === 429 || remaining === 0;
  if (spent && Number.isFinite(reset) && reset > 0) {
    const gate = jupiterGate();
    gate.until = Math.max(gate.until, reset * 1000 + 100);
  }
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

/** Waits for the provider's next rate-limit window at most this many times per request. */
export const MAX_RATE_LIMIT_RETRIES = 4;

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
  const jupiter = isJupiter(url);
  if (jupiter) await waitForJupiterWindow(options.signal);
  let response = await (options.fetcher ?? fetch)(url, {
    headers,
    signal: requestSignal(options),
    cache: "no-store",
  });
  if (jupiter) noteJupiterWindow(response);
  // Jupiter shares its short rate-limit window across Tokens and Price requests.
  // Respect the actual reset; retrying a full catalog after one second loses whole batches.
  // Concurrent batches can land in the same exhausted window more than once, so keep waiting for
  // the next window (bounded; the caller's deadline still applies) instead of giving up.
  for (
    let attempt = 0;
    response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES;
    attempt++
  ) {
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
    if (jupiter) await waitForJupiterWindow(options.signal);
    response = await (options.fetcher ?? fetch)(url, {
      headers,
      signal: requestSignal(options),
      cache: "no-store",
    });
    if (jupiter) noteJupiterWindow(response);
  }
  if (!response.ok) throw new MarketHttpError(response.status);
  return response.json() as Promise<unknown>;
}

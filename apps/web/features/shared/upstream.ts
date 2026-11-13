import "server-only";
import { AppError, mapError, type PublicError } from "@/server/errors";
import { logger } from "@/server/logger";

/**
 * Forces every upstream market/research request to fail, to exercise and screenshot the
 * "unavailable" states against a real build. Safe to leave on by mistake: it can only make data
 * disappear (shown as unavailable), never invent it. Not part of the env schema on purpose: it is a
 * local test switch, not configuration.
 */
export function upstreamOutageSimulated(): boolean {
  return process.env.AROMA_V1_SIMULATE_UPSTREAM_OUTAGE === "true";
}

/** A `fetch` that always rejects, used when the outage switch is on. */
export const offlineFetch: typeof fetch = async () => {
  throw new TypeError("simulated upstream outage");
};

export type Loaded<T> =
  { state: "ok"; data: T } | { state: "unavailable"; error: PublicError };

/**
 * Run a loader; log the real error server-side and return only a client-safe `{ code, message }`
 * (server/errors.ts `mapError`). Unknown errors become UPSTREAM_UNAVAILABLE rather than INTERNAL:
 * in M3 every loader is a read from an external provider.
 */
export async function load<T>(
  what: string,
  loader: () => Promise<T>,
): Promise<Loaded<T>> {
  try {
    return { state: "ok", data: await loader() };
  } catch (error) {
    const mapped = mapError(
      error instanceof AppError
        ? error
        : new AppError("UPSTREAM_UNAVAILABLE", { cause: error }),
    );
    logger.warn(
      { err: error, what, code: mapped.body.code },
      "v1 data load failed",
    );
    return { state: "unavailable", error: mapped.body };
  }
}

import "server-only";
import { testSwitchesAllowed } from "@/server/env.schema";
import { AppError, mapError, type PublicError } from "@/server/errors";
import { logger } from "@/server/logger";

let warned = false;

/**
 * Forces every upstream market/research request to fail, to exercise and screenshot the
 * "unavailable" states against a real build. It can only make data disappear (shown as
 * unavailable), never invent it. It is a local test switch, not configuration: it has no effect in
 * production unless a local `next start` opts in with AROMA_V1_ALLOW_TEST_SWITCHES=true (which the
 * env schema rejects on a Vercel production deployment), and it logs a warning whenever it is on.
 */
export function upstreamOutageSimulated(): boolean {
  if (process.env.AROMA_V1_SIMULATE_UPSTREAM_OUTAGE !== "true") return false;
  if (!testSwitchesAllowed(process.env)) {
    if (!warned) {
      warned = true;
      logger.warn(
        "AROMA_V1_SIMULATE_UPSTREAM_OUTAGE is set but ignored: test switches are disabled in production",
      );
    }
    return false;
  }
  if (!warned) {
    warned = true;
    logger.warn(
      "AROMA_V1_SIMULATE_UPSTREAM_OUTAGE is on: every upstream provider call will fail",
    );
  }
  return true;
}

/** Test helper: allow the one-time warning to fire again. */
export function resetOutageWarningForTests(): void {
  warned = false;
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

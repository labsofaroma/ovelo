import "server-only";
import { createHash } from "node:crypto";
import { logger } from "./logger";

/**
 * Trade-flow observability (AUDIT M-7): one structured log line per stage and a Sentry
 * breadcrumb when Sentry is configured. Wallet addresses and transaction signatures are never
 * logged in full: they become a short, stable fingerprint, enough to correlate events of one
 * order without identifying the wallet in logs or Sentry.
 */

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,88}$/;

export function fingerprint(value: string): string {
  return `fp:${createHash("sha256").update(value).digest("hex").slice(0, 10)}`;
}

/** Replace base58 addresses and signatures (also inside arrays) with fingerprints. */
export function redactIdentifiers(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string" && ADDRESS.test(value))
      out[key] = fingerprint(value);
    else if (Array.isArray(value))
      out[key] = value.map((item) =>
        typeof item === "string" && ADDRESS.test(item)
          ? fingerprint(item)
          : item,
      );
    else out[key] = value;
  }
  return out;
}

type SentryLike = {
  addBreadcrumb: (b: {
    category: string;
    message: string;
    level: "info" | "warning" | "error";
    data: Record<string, unknown>;
  }) => void;
  captureMessage: (
    message: string,
    context: { level: "error"; extra: Record<string, unknown> },
  ) => unknown;
};
let sentry: Promise<SentryLike | null> | null = null;

function loadSentry(): Promise<SentryLike | null> {
  if (!(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN))
    return Promise.resolve(null);
  sentry ??= import("@sentry/nextjs")
    .then((mod) => mod as unknown as SentryLike)
    .catch(() => null);
  return sentry;
}

export function tradeEvent(
  stage: string,
  data: Record<string, unknown>,
  level: "info" | "warning" | "error" = "info",
): void {
  const safe = redactIdentifiers(data);
  const log =
    level === "info"
      ? logger.info
      : level === "warning"
        ? logger.warn
        : logger.error;
  log.call(logger, { stage, ...safe }, `trade ${stage}`);
  void loadSentry().then((client) =>
    client?.addBreadcrumb({
      category: "trade",
      message: stage,
      level,
      data: safe,
    }),
  );
}

/**
 * Something an operator must act on (for example an RPC endpoint on the wrong cluster): an error
 * log line and a Sentry event (not just a breadcrumb), so an alert rule can page on it.
 */
export function alertEvent(stage: string, data: Record<string, unknown>): void {
  const safe = redactIdentifiers(data);
  logger.error({ stage, alert: true, ...safe }, `alert ${stage}`);
  void loadSentry().then((client) =>
    client?.captureMessage(`alert ${stage}`, { level: "error", extra: safe }),
  );
}

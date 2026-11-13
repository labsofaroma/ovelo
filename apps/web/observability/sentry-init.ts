import * as Sentry from "@sentry/nextjs";
import { buildSentryOptions } from "./sentry-options";

/**
 * Initialise Sentry for the current runtime. Loaded with a dynamic import and only when a DSN is
 * set, so deployments without a DSN neither bundle nor run the SDK (no-op).
 */
export function initSentry(
  dsn: string | undefined,
  environment?: string,
): boolean {
  const options = buildSentryOptions(dsn, environment);
  if (!options) return false;
  Sentry.init({
    ...options,
    beforeSend: (event) => options.beforeSend(event),
    beforeSendTransaction: (event) => options.beforeSendTransaction(event),
  });
  return true;
}

export const captureRequestError = Sentry.captureRequestError;

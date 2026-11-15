import { deployEnvOf } from "../server/platform";
import { scrubSentryEvent, type ScrubbableEvent } from "./scrub";

/** The Sentry init options we use in every runtime. Kept SDK-free so it is trivially testable. */
export type AromaSentryOptions = {
  dsn: string;
  environment: string;
  sendDefaultPii: false;
  tracesSampleRate: number;
  maxBreadcrumbs: number;
  beforeSend: <T extends ScrubbableEvent>(event: T) => T | null;
  beforeSendTransaction: <T extends ScrubbableEvent>(event: T) => T | null;
};

/**
 * Returns null when no DSN is configured, which means Sentry is never initialised and
 * nothing is sent (the whole integration is a no-op).
 */
export function buildSentryOptions(
  dsn: string | undefined,
  environment: string | undefined,
): AromaSentryOptions | null {
  const trimmed = dsn?.trim();
  if (!trimmed) return null;
  return {
    dsn: trimmed,
    // SENTRY_ENVIRONMENT wins; else the deploy environment from server/platform.ts (Phase H).
    environment: environment?.trim() || deployEnvOf(process.env),
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    maxBreadcrumbs: 30,
    beforeSend: (event) => scrubSentryEvent(event),
    beforeSendTransaction: (event) => scrubSentryEvent(event),
  };
}

import { deployEnvOf } from "../server/platform";
import { scrubSentryEvent, type ScrubbableEvent } from "./scrub";

/** The Sentry init options we use in every runtime. Kept SDK-free so it is trivially testable. */
export type OveloSentryOptions = {
  dsn: string;
  environment: string;
  /** Phase H: the image's commit (OVELO_REVISION label), or SENTRY_RELEASE when set. */
  release?: string;
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
): OveloSentryOptions | null {
  const trimmed = dsn?.trim();
  if (!trimmed) return null;
  return {
    dsn: trimmed,
    // SENTRY_ENVIRONMENT wins; else the deploy environment from server/platform.ts (Phase H).
    environment: environment?.trim() || deployEnvOf(process.env),
    ...releaseOf(process.env),
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    maxBreadcrumbs: 30,
    beforeSend: (event) => scrubSentryEvent(event),
    beforeSendTransaction: (event) => scrubSentryEvent(event),
  };
}

/** SENTRY_RELEASE wins; else the self-host image's commit (deploy/Dockerfile OVELO_REVISION). */
export function releaseOf(env: Readonly<Record<string, string | undefined>>): {
  release?: string;
} {
  const release =
    env.SENTRY_RELEASE?.trim() ||
    (env.OVELO_REVISION?.trim() && env.OVELO_REVISION.trim() !== "unknown"
      ? `ovelo-web@${env.OVELO_REVISION.trim()}`
      : "");
  return release ? { release } : {};
}

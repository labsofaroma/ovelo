// Next.js instrumentation hook: runs once per server instance (Node.js and Edge).
// 1. Validates the environment so a mis-configured v1 deployment fails fast at boot.
// 2. Starts Sentry for server and edge when SENTRY_DSN is set (otherwise a no-op).
import type { Instrumentation } from "next";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Throws EnvValidationError (variable names only) when AROMA_V1_ENABLED=true and the
    // environment is incomplete or invalid. Does nothing while v1 is off (the prototype).
    const { assertBootEnv } = await import("./server/env");
    assertBootEnv();
  }
  const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (
    dsn &&
    (process.env.NEXT_RUNTIME === "nodejs" ||
      process.env.NEXT_RUNTIME === "edge")
  ) {
    const { initSentry } = await import("./observability/sentry-init");
    initSentry(dsn, process.env.SENTRY_ENVIRONMENT);
  }
}

export const onRequestError: Instrumentation.onRequestError = async (
  ...args
) => {
  if (!(process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN)) return;
  const { captureRequestError } = await import("./observability/sentry-init");
  captureRequestError(...args);
};

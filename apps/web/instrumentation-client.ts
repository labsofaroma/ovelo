// Browser Sentry. No-op unless NEXT_PUBLIC_SENTRY_DSN is set at build time; when it is empty the
// condition is dead code, so the SDK is not loaded and the prototype's bundle is unchanged.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  void import("./observability/sentry-init").then((m) =>
    m.initSentry(dsn, process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT),
  );
}

export {};

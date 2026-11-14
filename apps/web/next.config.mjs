/** @type {import('next').NextConfig} */
const config = {
  poweredByHeader: false,
  // E2E builds (with the test wallet bridge) go to their own directory so they can never be
  // mistaken for, or overwrite, the production build in .next (e2e/fork/run.ts).
  distDir: process.env.AROMA_NEXT_DIST_DIR || ".next",
  // Always inlined, even when unset, so webpack can drop the E2E test wallet and the Privy stack at
  // compile time (features/wallet/WalletBoundary.tsx). An unset NEXT_PUBLIC_* is otherwise left
  // as a runtime lookup and its dynamic import still emits a chunk. The secret scan checks this.
  env: {
    NEXT_PUBLIC_AROMA_E2E_WALLET:
      process.env.NEXT_PUBLIC_AROMA_E2E_WALLET === "true" ? "true" : "false",
    NEXT_PUBLIC_PRIVY_APP_ID: process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "",
    // M7: the localnet wallet cluster (test builds only), dropped at compile time otherwise.
    NEXT_PUBLIC_AROMA_LOCALNET:
      process.env.NEXT_PUBLIC_AROMA_LOCALNET === "true" ? "true" : "false",
  },
  compress: true,
  // @aroma/ui ships TypeScript source and CSS Modules; Next compiles it with the app.
  transpilePackages: ["@aroma/ui", "@aroma/guard"],
  // Rewrite `import { X } from "@aroma/ui"` to X's own module, so a page ships only the primitives
  // it renders, not the whole barrel (M3: /v1/markets first-load budget, REWRITE-PLAN §8).
  // globalNotFound (M4): three root layouts ((prototype), (app), (marketing)) mean unmatched URLs
  // need their own document, app/global-not-found.tsx.
  experimental: { optimizePackageImports: ["@aroma/ui"], globalNotFound: true },
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      { protocol: "https", hostname: "xstocks-metadata.backed.fi" },
      { protocol: "https", hostname: "prestocks.com" },
      { protocol: "https", hostname: "backpack.exchange" },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      // The prototype's CSP, unchanged, for prototype paths ONLY (everything except /v1, /v1/*,
      // /api/v1 and /api/v1/*). Those get the strict per-request nonce CSP from middleware.ts
      // (M4). Tightening the prototype is M7 work (docs/REWRITE-PLAN.md, M4 status).
      {
        source: "/:path((?!v1(?:/|$)|api/v1(?:/|$)).*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "base-uri 'self'",
              "object-src 'none'",
              "frame-ancestors 'none'",
              "form-action 'self'",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
              "style-src 'self' 'unsafe-inline'",
              `script-src 'self' 'unsafe-inline' ${process.env.NODE_ENV === "development" ? "'unsafe-eval'" : ""} https://challenges.cloudflare.com https://va.vercel-scripts.com`,
              "connect-src 'self' https: wss: http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*",
              "frame-src https://auth.privy.io https://*.privy.io https://*.walletconnect.com https://verify.walletconnect.org https://challenges.cloudflare.com",
              "worker-src 'self' blob:",
            ].join("; "),
          },
        ],
      },
    ];
  },
  webpack: (config) => {
    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      {
        module: /ox/,
        message:
          /Critical dependency: the request of a dependency is an expression/,
      },
    ];
    return config;
  },
};
// Sentry's build plugin (source-map upload) is applied only when an auth token is present, so
// builds without Sentry are unchanged. Runtime error capture is wired in instrumentation.ts and
// is a no-op without a DSN.
const sentry = process.env.SENTRY_AUTH_TOKEN
  ? await import("@sentry/nextjs")
  : null;
export default sentry
  ? sentry.withSentryConfig(config, {
      silent: true,
      telemetry: false,
      disableLogger: true,
    })
  : config;

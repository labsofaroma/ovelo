import { LEGACY_REDIRECTS } from "./redirects.mjs";

/** @type {import('next').NextConfig} */
const config = {
  poweredByHeader: false,
  // E2E builds (with the test wallet bridge) go to their own directory so they can never be
  // mistaken for, or overwrite, the production build in .next (e2e/fork/run.ts).
  distDir: process.env.AROMA_NEXT_DIST_DIR || ".next",
  // Always inlined, even when unset, so webpack can drop the E2E test wallet at compile time
  // (features/wallet/WalletBoundary.tsx). An unset NEXT_PUBLIC_* is otherwise left
  // as a runtime lookup and its dynamic import still emits a chunk. The secret scan checks this.
  env: {
    NEXT_PUBLIC_AROMA_E2E_WALLET:
      process.env.NEXT_PUBLIC_AROMA_E2E_WALLET === "true" ? "true" : "false",
    // M7: the localnet wallet cluster (test builds only), dropped at compile time otherwise.
    NEXT_PUBLIC_AROMA_LOCALNET:
      process.env.NEXT_PUBLIC_AROMA_LOCALNET === "true" ? "true" : "false",
  },
  compress: true,
  // @aroma/ui ships TypeScript source and CSS Modules; Next compiles it with the app.
  transpilePackages: ["@aroma/ui", "@aroma/guard"],
  // Rewrite `import { X } from "@aroma/ui"` to X's own module, so a page ships only the primitives
  // it renders, not the whole barrel (M3: /markets first-load budget, REWRITE-PLAN §8).
  // globalNotFound (M4): two root layouts ((app), (marketing)) mean unmatched URLs need their own
  // document, app/global-not-found.tsx.
  experimental: { optimizePackageImports: ["@aroma/ui"], globalNotFound: true },
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      { protocol: "https", hostname: "xstocks-metadata.backed.fi" },
      { protocol: "https", hostname: "prestocks.com" },
      { protocol: "https", hostname: "backpack.exchange" },
    ],
  },
  // M9: old URLs (the /v1 prefix and the prototype paths that moved) answer 308 (redirects.mjs).
  async redirects() {
    return LEGACY_REDIRECTS;
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
            // The camera is for nothing in Aroma; payments go through wallets, never the browser.
            value:
              "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), browsing-topics=()",
          },
        ],
      },
      // Every page and API route gets the per-request nonce CSP from middleware.ts (M9: the
      // prototype's own policy went with the prototype).
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

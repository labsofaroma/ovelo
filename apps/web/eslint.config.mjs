import { createConfig } from "@aroma/config/eslint";

/**
 * v1 code (REWRITE-PLAN §7.3 W1: wallet-only login). The prototype keeps its Privy login until
 * M9 removes it with the `@privy-io/react-auth` dependency; v1 code must never import it.
 * Proven by scripts/eslint-v1-imports.test.ts.
 */
export const V1_PATHS = [
  "features/**",
  "server/**",
  "observability/**",
  "app/(app)/**",
  "app/(marketing)/**",
  "app/api/v1/**",
  "lib/sdk/**",
  "e2e/**",
  "middleware.ts",
  "instrumentation.ts",
  "instrumentation-client.ts",
];
const NO_EMBEDDED_WALLET =
  "v1 is wallet-only (REWRITE-PLAN §7.3 W1): no Privy or embedded wallets. Use the Wallet Standard stack in features/wallet.";

export default [
  ...createConfig({
    dir: import.meta.dirname,
    next: true,
    // Prototype code: rules report as warnings. New code (server/, app/(app), app/(marketing),
    // app/api/v1, instrumentation, sentry configs) is held to errors.
    legacy: [
      "components/**",
      "lib/**",
      "tests/**",
      "styles/**",
      "scripts/verify-pricing-oracles.mjs",
      "middleware.ts",
      "app/**",
    ],
    // The v1 client moved to `packages/guard` (M7); the re-export here is new code (errors).
    legacyExclude: [
      "app/(app)/**",
      "app/(marketing)/**",
      "app/api/v1/**",
      "lib/sdk/guard/v1/**",
    ],
  }),
  {
    files: V1_PATHS,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@privy-io/*", "@privy-io/**"],
              message: NO_EMBEDDED_WALLET,
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression[source.value=/^@privy-io\\//]",
          message: NO_EMBEDDED_WALLET,
        },
        {
          selector:
            "CallExpression[callee.name='require'][arguments.0.value=/^@privy-io\\//]",
          message: NO_EMBEDDED_WALLET,
        },
      ],
    },
  },
  {
    // Next.js loads PostCSS plugins with require(), so this wrapper must be CommonJS.
    files: ["postcss/**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
];

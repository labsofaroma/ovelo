import { createConfig } from "@aroma/config/eslint";

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
    // Next.js loads PostCSS plugins with require(), so this wrapper must be CommonJS.
    files: ["postcss/**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
];

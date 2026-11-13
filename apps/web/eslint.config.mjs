import { createConfig } from "@aroma/config/eslint";

export default createConfig({
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
  legacyExclude: ["app/(app)/**", "app/(marketing)/**", "app/api/v1/**"],
});

import { defineConfig } from "vitest/config";
import preset from "@ovelo/config/vitest";

// REWRITE-PLAN §8 / M7 B8: hand-written code in this package stays at 85% or better. The
// Codama output, the IDL and test fixtures are excluded.
// The preset is typed by @ovelo/config's vitest copy (resolved with @types/node 20); this package
// pins @types/node 22, so its vitest is a different copy and the two config types do not unify
// (TS2769 on a clean install). Read the preset as plain objects so the types never meet; the
// runtime values are identical.
const base: object = preset;
const baseTest: object = (preset as { test?: object }).test ?? {};

export default defineConfig({
  ...base,
  test: {
    ...baseTest,
    include: ["src/**/*.test.ts"],
    testTimeout: 60_000,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      include: ["src/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "**/index.ts",
        "src/v1/generated/**",
        "src/v1/idl/**",
        "src/**/test/**",
        "**/types.ts",
      ],
      thresholds: { lines: 85, functions: 85, statements: 85, branches: 80 },
    },
  },
});

import { defineConfig } from "vitest/config";
import preset from "@aroma/config/vitest";

// REWRITE-PLAN §8 / M7 B8: hand-written code in this package stays at 85% or better. The
// Codama output, the IDL and test fixtures are excluded.
export default defineConfig({
  ...preset,
  test: {
    ...preset.test,
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

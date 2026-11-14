import { defineConfig } from "vitest/config";
import preset from "@aroma/config/vitest";

// B8 gate: the keeper's modules at 80% or better. Entry points (server.ts, cli.ts) and the
// production client wiring are exercised by the local run, not unit tests.
export default defineConfig({
  ...preset,
  test: {
    ...preset.test,
    include: ["src/**/*.test.ts"],
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/test/**",
        "src/server.ts",
        "src/cli.ts",
        "src/index.ts",
        "src/services.ts",
      ],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
    },
  },
});

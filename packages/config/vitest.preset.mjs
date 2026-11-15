/**
 * Shared Vitest preset. Spread it into a package's vitest.config:
 *   import { defineConfig } from "vitest/config";
 *   import preset from "@ovelo/config/vitest";
 *   export default defineConfig({ ...preset, test: { ...preset.test, include: [...] } });
 */
const preset = {
  test: {
    environment: "node",
    globals: false,
    restoreMocks: true,
    clearMocks: true,
    passWithNoTests: false,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
    },
  },
};
export default preset;

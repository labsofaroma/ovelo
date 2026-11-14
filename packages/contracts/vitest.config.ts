import { defineConfig } from "vitest/config";

// `unit` runs in `pnpm test` (no SBF build needed). `litesvm` needs the devnet-mock build and the
// pinned upstream binaries (`pnpm --filter @aroma/contracts build && … test:fixtures`).
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["scripts/**/*.test.ts", "tests/unit/**/*.test.ts"],
          testTimeout: 60_000,
        },
      },
      {
        test: {
          name: "litesvm",
          environment: "node",
          include: ["tests/litesvm/**/*.test.ts"],
          testTimeout: 120_000,
          hookTimeout: 120_000,
          pool: "forks",
        },
      },
    ],
  },
});

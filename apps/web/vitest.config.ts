import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import preset from "@aroma/config/vitest";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  ...preset,
  // Component tests (features/**/*.test.tsx) need the automatic JSX runtime; tsconfig says "preserve".
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      // `server-only` throws outside the react-server condition; unit tests run in plain Node.
      "server-only": here("./server/test/server-only-stub.ts"),
      "@": here("."),
    },
  },
  test: {
    ...preset.test,
    // The prototype node:test suites keep running through `test:legacy` until M2 ports them (ported modules move to lib/sdk/<module>/*.test.ts).
    include: [
      "server/**/*.test.ts",
      "observability/**/*.test.ts",
      "lib/sdk/**/*.test.ts",
      "features/**/*.test.{ts,tsx}",
    ],
    // PGlite (server/db/schema.test.ts) boots a WASM Postgres in beforeAll; 10s is too tight when
    // the whole suite runs in parallel.
    hookTimeout: 30_000,
    env: { LOG_LEVEL: "silent" },
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      // M2 gate (REWRITE-PLAN section 7): the ported SDK modules must stay at 85% or better.
      // Not listed: the client/state/portfolio layer (replaced by TanStack Query in M3+), guard,
      // subscriptions, recurring-investing and devnet-xstocks (rewritten against the v1 contract in
      // M6), wallet-capabilities (dropped with the prototype), and generated IDL files.
      include: [
        "lib/sdk/core/**/*.ts",
        "lib/sdk/pyth/**/*.ts",
        "lib/sdk/jupiter/**/*.ts",
        "lib/sdk/markets/**/*.ts",
        "lib/sdk/research/**/*.ts",
        "lib/sdk/baskets/**/*.ts",
        "lib/sdk/paper/**/*.ts",
        "lib/sdk/trade/**/*.ts",
        // M4 gate (REWRITE-PLAN §8): server infrastructure and feature server modules, 80%.
        "server/**/*.ts",
        "features/*/server.ts",
        "features/*/server/**/*.ts",
      ],
      exclude: [
        "**/*.test.ts",
        "**/index.ts",
        "**/idl/**",
        "**/test-fixtures.ts",
        "**/types.ts",
        "**/test-*.ts",
        "server/test/**",
        // Boot/CLI entry points and generated SQL are exercised by the build, not unit tests.
        "server/db/migrate.ts",
        "server/db/migrations/**",
      ],
      thresholds: {
        "lib/sdk/**/*.ts": {
          lines: 85,
          functions: 85,
          statements: 85,
          branches: 80,
        },
        "server/**/*.ts": {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 70,
        },
        "features/*/server{.ts,/**/*.ts}": {
          lines: 80,
          functions: 80,
          statements: 80,
          branches: 70,
        },
      },
    },
  },
});

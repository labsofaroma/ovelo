import { defineConfig, devices } from "@playwright/test";

/**
 * M4 trade E2E (LOCAL FORK ONLY). Started by `pnpm --filter @aroma/web e2e:fork`
 * (e2e/fork/run.ts), which brings up the fork, the Jupiter stand-in and the E2E build first.
 * Serial: the specs share one funded test wallet and one rate-limit window.
 */
export default defineConfig({
  testDir: "./trade",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  timeout: 180_000,
  expect: { timeout: 60_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3200",
    ...devices["Desktop Chrome"],
  },
  projects: [{ name: "chromium" }],
});

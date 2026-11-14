import { defineConfig, devices } from "@playwright/test";

/**
 * M7 invest E2E (LOCAL VALIDATOR ONLY). Started by `pnpm --filter @aroma/web e2e:invest`
 * (e2e/invest/run.ts), which brings up the chain, Postgres, Redis, the app and the keeper first.
 * Serial: one plan moves through its periods in real (validator) time.
 */
export default defineConfig({
  testDir: "./invest",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  timeout: 300_000,
  expect: { timeout: 60_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3300",
    ...devices["Desktop Chrome"],
  },
  projects: [{ name: "chromium" }],
});

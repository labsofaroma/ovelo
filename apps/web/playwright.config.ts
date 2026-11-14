import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke + accessibility suite (M3). LOCAL ONLY for now: it needs network access to the live market
 * providers and a production build with a complete environment (placeholders are enough):
 *
 *   set -a; . ./.env.example; set +a; pnpm --filter @aroma/web build
 *   pnpm --filter @aroma/web test:e2e        (same environment exported)
 *
 * Two servers from the same build: the normal one, and one with the upstream-outage switch on
 * (AROMA_V1_SIMULATE_UPSTREAM_OUTAGE) to prove the "unavailable" states.
 */
import { OUTAGE_PORT, PORT } from "./e2e/ports";
const appEnv = { ...process.env } as Record<string, string>;

export default defineConfig({
  testDir: "./e2e",
  // The trade suite needs the local fork (pnpm e2e:fork, e2e/trade.config.ts) and the invest
  // suite the local validator and keeper (pnpm e2e:invest, e2e/invest.config.ts).
  testIgnore: ["trade/**", "invest/**"],
  fullyParallel: false,
  workers: 2,
  reporter: [["list"]],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: { baseURL: `http://localhost:${PORT}`, ...devices["Desktop Chrome"] },
  projects: [{ name: "chromium" }],
  webServer: [
    {
      command: `next start -p ${PORT}`,
      url: `http://localhost:${PORT}/privacy`,
      env: appEnv,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: `next start -p ${OUTAGE_PORT}`,
      url: `http://localhost:${OUTAGE_PORT}/privacy`,
      env: {
        ...appEnv,
        // `next start` runs with NODE_ENV=production, where test switches are off unless opted in.
        AROMA_V1_ALLOW_TEST_SWITCHES: "true",
        AROMA_V1_SIMULATE_UPSTREAM_OUTAGE: "true",
      },
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});

import { edgeHeaders } from "./local-start";
import { defineConfig, devices } from "@playwright/test";

/**
 * M4 trade E2E (LOCAL FORK ONLY). Started by `pnpm --filter @ovelo/web e2e:fork`
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
    // Phase H: the app runs behind the origin lock in cloudflare mode, as in production; the
    // browser plays Cloudflare's edge with an allowed country (e2e/local-start.ts). Specs that
    // override extraHTTPHeaders start from edgeHeaders() too.
    extraHTTPHeaders: edgeHeaders("DE"),
  },
  // Phase A: the beta-gate spec runs first (no beta access yet), then M9's compliance spec
  // (beta access, no terms yet), then the purchase specs.
  projects: [
    { name: "beta", testMatch: /beta-gate\.spec\.ts$/ },
    {
      name: "compliance",
      testMatch: /compliance\.spec\.ts$/,
      dependencies: ["beta"],
    },
    // M11: notifications opt in before the purchases and are checked after them.
    {
      name: "notify-optin",
      testMatch: /notify-optin\.spec\.ts$/,
      dependencies: ["compliance"],
    },
    {
      name: "chromium",
      testIgnore:
        /(compliance|beta-gate|notify-optin|notify-delivery)\.spec\.ts$/,
      dependencies: ["notify-optin"],
    },
    {
      name: "notify-delivery",
      testMatch: /notify-delivery\.spec\.ts$/,
      dependencies: ["chromium"],
    },
  ],
});

import { defineConfig, devices } from "@playwright/test";

const PORT = 61001;

/**
 * Browser suites run against the BUILT workbench (`pnpm build:stories` first):
 *   pnpm --filter @aroma/ui build:stories && pnpm --filter @aroma/ui test:a11y
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: [["list"]],
  timeout: 30_000,
  use: { baseURL: `http://localhost:${PORT}`, ...devices["Desktop Chrome"] },
  projects: [{ name: "chromium" }],
  webServer: {
    command: `ladle preview -o dist/stories --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});

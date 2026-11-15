import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  expectNoAxeViolations,
  expectPageBasics,
  THEMES,
  useTheme,
} from "../helpers";
import { installTestWallet } from "./wallet";

/**
 * M11 Step 3 on the fork: /get-started is accessible (light and dark, 390 and 1440 px) with real
 * balances, and the time from opening it to a confirmed first basket buy is measured against the
 * ROADMAP target (< 2 minutes of app time; the mocked wallet signs at once, so the wallet's own UI
 * is not counted). The wallet accepted the terms and redeemed its invite in the earlier projects.
 */
const BASKET = process.env.E2E_BASKET_ID ?? "sol-energy";

for (const theme of THEMES)
  for (const width of [390, 1440])
    test(`get started: no axe violations, ${theme}, ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await useTheme(page, theme);
      await installTestWallet(page);
      await page.goto("/get-started");
      await expectPageBasics(page, theme);
      await expect(
        page.getByRole("heading", { name: "1. A Solana wallet" }),
      ).toBeVisible();
      await expectNoAxeViolations(page);
      await page
        .getByRole("button", { name: "Connect wallet" })
        .first()
        .click();
      await expect(
        page.getByText(
          /^This wallet has .* SOL and .* USDC on Solana mainnet\.$/,
        ),
      ).toBeVisible();
      await expectNoAxeViolations(page);
    });

test("time to first basket buy, from /get-started to confirmed", async ({
  page,
}) => {
  await installTestWallet(page);
  const started = Date.now();
  await page.goto("/get-started");
  await page.getByRole("button", { name: "Connect wallet" }).first().click();
  await expect(page.getByText(/^This wallet has /)).toBeVisible();
  const open = page.getByRole("link", { name: "Open the trade ticket" });
  await expect(open).toBeVisible();
  // The fork recorded routes for one basket; follow the suggestion when it is that basket.
  if ((await open.getAttribute("href")) === `/basket/${BASKET}`)
    await open.click();
  else await page.goto(`/basket/${BASKET}`);
  const ticket = page.locator("section", {
    has: page.getByRole("heading", { name: /^Buy / }),
  });
  const connect = ticket.getByRole("button", { name: "Connect wallet" });
  if (await connect.isVisible().catch(() => false)) await connect.click();
  await ticket.getByLabel(/Amount/).fill("2");
  await ticket.getByRole("button", { name: "Get quote" }).click();
  await ticket.getByRole("button", { name: "Sign and buy on mainnet" }).click();
  await expect(ticket.getByText("Confirmed on Solana mainnet.")).toBeVisible();
  const seconds = (Date.now() - started) / 1000;
  const result = {
    seconds,
    targetSeconds: 120,
    basket: BASKET,
    measuredAt: new Date().toISOString(),
  };
  writeFileSync(
    test.info().outputPath("time-to-first-basket.json"),
    JSON.stringify(result),
  );
  test.info().annotations.push({
    type: "time-to-first-basket-seconds",
    description: seconds.toFixed(1),
  });
  process.stdout.write(
    `[m11] time to first basket buy: ${seconds.toFixed(1)} s (target < 120 s)\n`,
  );
  expect(seconds).toBeLessThan(120);
});

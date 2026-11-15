import { expect, test } from "@playwright/test";
import { expectNoAxeViolations, THEMES, useTheme } from "../helpers";
import { installTestWallet } from "./wallet";

/**
 * M11 Step 4 on the fork, after creator.spec.ts: the E2E wallet (a creator with two baskets, one
 * bought through the ticket and once through the Action, then archived) signs in to its own
 * dashboard. Counts come from the confirmed receipts; the Action buy shows as the Blink share.
 */
for (const theme of THEMES)
  test(`creator dashboard (${theme}): own baskets, buys, Blink share, versions; accessible`, async ({
    page,
  }) => {
    await useTheme(page, theme);
    await installTestWallet(page);
    await page.goto("/creators/dashboard");
    await page.getByRole("button", { name: "Connect wallet" }).first().click();
    await page
      .getByRole("button", { name: "Sign to open your dashboard" })
      .click();
    await expect(page.getByText(/^Source: /)).toBeVisible();
    const cards = page.locator("section", {
      has: page.getByRole("heading", { level: 2 }),
    });
    await expect(cards.first()).toBeVisible();
    const bought = cards
      .filter({ has: page.getByRole("row", { name: /All time/ }) })
      .first();
    const allTime = bought.getByRole("row", { name: /All time/ });
    await expect(allTime.getByRole("cell").nth(0)).toHaveText("2");
    await expect(allTime.getByRole("cell").nth(3)).toHaveText("1 of 2");
    await expect(bought.getByText(/^Version 1, published/)).toBeVisible();
    await expectNoAxeViolations(page);
  });

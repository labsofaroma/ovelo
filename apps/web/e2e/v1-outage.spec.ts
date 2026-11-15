import { expect, test } from "@playwright/test";
import { expectNoAxeViolations, THEMES, useTheme } from "./helpers";
import { OUTAGE_BASE_URL } from "./ports";

/**
 * Server started with OVELO_V1_SIMULATE_UPSTREAM_OUTAGE=true: every provider call fails.
 * Only DYNAMIC routes are visited here. Both servers share one .next directory, and an ISR
 * route (stock, baskets list, landing) regenerated during an outage would be written to the
 * shared cache. The stock page's unavailable states are covered by features/stock tests.
 */
test.use({ baseURL: OUTAGE_BASE_URL });

for (const theme of THEMES) {
  test(`markets shows an explicit unavailable state and no figures (${theme})`, async ({
    page,
  }) => {
    await useTheme(page, theme);
    const response = await page.goto("/markets");
    expect(response?.status()).toBe(200);
    await expect(page.locator("main").getByRole("alert")).toContainText(
      "Market data is unavailable right now",
    );
    await expect(page.locator("main")).not.toContainText("$");
    await expect(page.locator("table")).toHaveCount(0);
    await expectNoAxeViolations(page);
  });
}

test("basket detail and watchlist degrade to explicit notices", async ({
  page,
}) => {
  await page.goto("/basket/any-basket?range=90d");
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "This basket is unavailable",
  );
  await expect(page.locator("main")).not.toContainText("$");
});

import { expect, test, type Page } from "@playwright/test";
import {
  expectNoAxeViolations,
  expectPageBasics,
  THEMES,
  useTheme,
} from "./helpers";

/** Real symbols and basket ids come from the live catalog, never hard-coded. */
async function firstHref(
  page: Page,
  path: string,
  prefix: string,
): Promise<string> {
  await page.goto(path);
  const href = await page
    .locator(`main a[href^="${prefix}"]`)
    .first()
    .getAttribute("href");
  expect(href, `no ${prefix} link on ${path}`).toBeTruthy();
  return href!;
}

let stockPath = "";
let basketPath = "";

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  stockPath = await firstHref(page, "/v1/markets?priced=1", "/v1/stock/");
  basketPath = await firstHref(page, "/v1/baskets", "/v1/basket/");
  await page.close();
});

const PAGES = [
  { name: "landing", path: () => "/v1" },
  { name: "markets", path: () => "/v1/markets" },
  {
    name: "markets (filtered)",
    path: () => "/v1/markets?issuer=xstocks&sort=change",
  },
  { name: "stock", path: () => stockPath },
  { name: "baskets", path: () => "/v1/baskets" },
  { name: "basket", path: () => basketPath },
  { name: "watchlist", path: () => "/v1/watchlist" },
  { name: "privacy", path: () => "/v1/privacy" },
  { name: "terms", path: () => "/v1/terms" },
];

for (const theme of THEMES) {
  for (const entry of PAGES) {
    test(`${entry.name} loads with zero axe violations (${theme})`, async ({
      page,
    }) => {
      await useTheme(page, theme);
      const response = await page.goto(entry.path());
      expect(response?.status()).toBe(200);
      await expectPageBasics(page, theme);
      // Wait for lazy islands (chart) so they are audited too.
      await page.waitForLoadState("networkidle");
      await expectNoAxeViolations(page);
    });
  }
}

test("every price on markets carries a source and a time", async ({ page }) => {
  await page.goto("/v1/markets?priced=1");
  await expect(
    page.getByText(/^As of \d{1,2} \w+ \d{4}, \d{2}:\d{2} UTC$/).first(),
  ).toBeVisible();
  await expect(page.locator("caption")).toContainText(
    /Snapshot \d{1,2} \w+ \d{4}/,
  );
  const firstPriceCell = page.locator("tbody tr").first().locator("td").nth(1);
  await expect(firstPriceCell).toContainText(/Jupiter|issuer|No token price/);
});

test("stock page: a labelled trade ticket and no quote until one is requested (M4)", async ({
  page,
}) => {
  await page.goto(stockPath);
  await expect(
    page.getByRole("radio", { name: "Mainnet spot purchase" }),
  ).toBeChecked();
  await expect(
    page.getByRole("radio", { name: "Paper practice" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Get quote" })).toBeDisabled();
  await expect(page.getByText(/minimum received/i)).toHaveCount(0);
});

test("stale state appears when the observation ages (forced via the browser clock)", async ({
  page,
}) => {
  await page.clock.install({ time: Date.now() + 2 * 60 * 60_000 });
  await page.goto("/v1/markets");
  await expect(page.locator('[data-freshness="stale"]').first()).toHaveText(
    "Stale",
  );
});

test("watchlist: star on markets, row appears on the watchlist page", async ({
  page,
}) => {
  await page.goto("/v1/markets?priced=1");
  const star = page
    .locator("tbody tr")
    .first()
    .getByRole("button", { name: /^Watch / });
  await expect(star).toBeEnabled();
  const name = (await star.getAttribute("aria-label"))!.replace("Watch ", "");
  await star.click();
  await expect(star).toHaveAttribute("aria-pressed", "true");
  await page.goto("/v1/watchlist");
  await expect(page).toHaveURL(/\?m=/);
  await expect(page.locator("tbody")).toContainText(name);
});

test("unknown stock is a 404 with a helpful page", async ({ page }) => {
  const response = await page.goto("/v1/stock/NOTAREALSYMBOLx");
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "Stock not found" }),
  ).toBeVisible();
  await expectNoAxeViolations(page);
});

test("unknown basket is a 404 with a helpful page", async ({ page }) => {
  const response = await page.goto("/v1/basket/not-a-basket");
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "Basket not found" }),
  ).toBeVisible();
  await expectNoAxeViolations(page);
});

test("OG image and sitemap entries exist", async ({ request }) => {
  const og = await request.get("/v1/og.png");
  expect(og.status()).toBe(200);
  expect(og.headers()["content-type"]).toContain("image/png");
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain("/v1/markets");
});

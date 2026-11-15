import { expect, test } from "@playwright/test";
import {
  expectNoAxeViolations,
  expectPageBasics,
  THEMES,
  useTheme,
} from "./helpers";

/**
 * M9 cutover on a production build (smoke suite): the old URLs redirect 308 to the root pages,
 * the removed prototype APIs answer 410 GONE, and the new /settings page is accessible.
 */
test("old URLs redirect 308 to the root pages, keeping the query", async ({
  request,
}) => {
  for (const [from, to] of [
    ["/v1", "/"],
    ["/v1/markets?q=apple", "/markets?q=apple"],
    ["/v1/basket/sol-core", "/basket/sol-core"],
    ["/landing", "/"],
    ["/app", "/markets"],
    ["/sip", "/invest"],
    ["/basket/builder", "/basket/new"],
    ["/orders", "/portfolio#activity"],
  ] as const) {
    const response = await request.get(from, { maxRedirects: 0 });
    expect(response.status(), from).toBe(308);
    const location = new URL(response.headers().location ?? "", "http://x");
    expect(location.pathname + location.search + location.hash).toBe(to);
  }
});

test("removed prototype APIs answer 410 { code: GONE, message }", async ({
  request,
}) => {
  for (const path of [
    "/api/markets",
    "/api/trade/order",
    "/api/actions/buy-baskets/sol-core",
  ]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(410);
    expect(await response.json()).toEqual({
      code: "GONE",
      message:
        "This endpoint was removed. Use the current Ovelo app or its /api/v1 API.",
    });
  }
});

for (const theme of THEMES)
  test(`settings: every mode explained, no axe violations (${theme})`, async ({
    page,
  }) => {
    await useTheme(page, theme);
    await page.goto("/settings");
    await expectPageBasics(page, theme);
    for (const mode of [
      "Mainnet spot purchase",
      "Devnet recurring test",
      "Paper practice",
    ])
      await expect(page.getByText(mode, { exact: true })).toBeVisible();
    await expect(page.getByText(/No wallet connected/)).toBeVisible();
    await expectNoAxeViolations(page);
  });

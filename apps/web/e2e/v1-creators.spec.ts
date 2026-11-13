import { expect, test } from "@playwright/test";
import {
  expectNoAxeViolations,
  expectPageBasics,
  THEMES,
  useTheme,
} from "./helpers";

/**
 * M5a smoke + accessibility for the creator pages (LOCAL ONLY, like v1-smoke.spec.ts). The builder
 * reads the live market snapshot; the directory reads Postgres, so without a reachable database it
 * must render the explicit unavailable state (never an empty list).
 */

for (const theme of THEMES) {
  test(`basket builder loads with zero axe violations (${theme})`, async ({
    page,
  }) => {
    await useTheme(page, theme);
    const response = await page.goto("/v1/basket/new");
    expect(response?.status()).toBe(200);
    await expectPageBasics(page, theme);
    await expectNoAxeViolations(page);
  });

  test(`creator directory loads with zero axe violations (${theme})`, async ({
    page,
  }) => {
    await useTheme(page, theme);
    const response = await page.goto("/v1/creators");
    expect(response?.status()).toBe(200);
    await expectPageBasics(page, theme);
    const unavailable = page.getByText(
      "The creator directory is unavailable right now",
    );
    const listed = page.getByText(/published baskets? · Source:/);
    await expect(unavailable.or(listed)).toBeVisible();
    await expectNoAxeViolations(page);
  });
}

test("builder: pick assets, weights reach 100%, preview renders, draft survives a reload, publish stays disabled", async ({
  page,
}) => {
  await useTheme(page, "light");
  await page.goto("/v1/basket/new");
  await page.getByLabel("Basket name").fill("Smoke basket");
  await page.getByLabel("Ticker").fill("smoke");
  await expect(page.getByLabel("Ticker")).toHaveValue("SMOKE");

  const options = page.locator('button[aria-pressed="false"]:not([disabled])');
  await options.nth(0).click();
  await options.nth(0).click();
  await expect(page.locator('button[aria-pressed="true"]')).toHaveCount(2);
  await expect(
    page.getByText("Total is 100.00%. Ready to preview."),
  ).toBeVisible();

  // Keyboard: move 1% from the first asset; the total goes off 100%, Normalize brings it back.
  const firstWeight = page
    .getByRole("textbox", { name: /weight, percent/ })
    .first();
  await firstWeight.focus();
  await page.keyboard.press("Shift+ArrowDown");
  await expect(
    page.getByText(/Total is 99\.00%\. 1\.00% left to assign\./),
  ).toBeVisible();
  await page.getByRole("button", { name: "Normalize to 100%" }).click();
  await expect(
    page.getByText("Total is 100.00%. Ready to preview."),
  ).toBeVisible();

  const preview = page.getByRole("region", { name: "Preview" });
  await expect(preview.locator("tbody tr")).toHaveCount(2);
  await expect(preview).toContainText("Smoke basket (SMOKE)");

  const publish = page.getByRole("button", {
    name: "Publish (connect wallet)",
  });
  await expect(publish).toBeDisabled();
  await expect(page.getByText("The allocation is complete.")).toBeVisible();

  await page.reload();
  await expect(
    page.getByText("Restored your draft from this browser."),
  ).toBeVisible();
  await expect(page.getByLabel("Basket name")).toHaveValue("Smoke basket");
  await expect(page.locator('button[aria-pressed="true"]')).toHaveCount(2);
  await expectNoAxeViolations(page);

  await page.getByRole("button", { name: "Clear draft" }).click();
  await expect(page.locator('button[aria-pressed="true"]')).toHaveCount(0);
});

test("builder works when browser storage is blocked, and says the draft is not saved", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
  });
  const response = await page.goto("/v1/basket/new");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByText(/This browser is not letting Aroma save/),
  ).toBeVisible();
  await page
    .locator('button[aria-pressed="false"]:not([disabled])')
    .first()
    .click();
  await expect(page.locator('button[aria-pressed="true"]')).toHaveCount(1);
});

test("creator API is behind the v1 flag and refuses unsigned writes", async ({
  request,
}) => {
  const read = await request.get(
    "/api/v1/creators/baskets/00000000-0000-4000-8000-000000000000",
  );
  expect([404, 503]).toContain(read.status());
  const write = await request.post("/api/v1/creators/baskets", {
    data: { action: "publish" },
  });
  expect(write.status()).toBe(400);
  expect(Object.keys(await write.json()).sort()).toEqual(["code", "message"]);
});

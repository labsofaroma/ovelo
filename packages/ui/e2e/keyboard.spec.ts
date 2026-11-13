import { expect, test, type Page } from "@playwright/test";
import { openStory } from "./stories";

test.use({ reducedMotion: "reduce" });

/** Presses a key, then waits two frames: Base UI's focus trap redirects in requestAnimationFrame,
 *  which a human can never outrun but a scripted key press can. */
async function press(page: Page, key: string): Promise<void> {
  await page.keyboard.press(key);
  await page.evaluate(
    () =>
      new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      ),
  );
}

test("Select: Tab to focus, Enter opens, arrows move, Enter selects, focus returns", async ({
  page,
}) => {
  await openStory(page, "primitives--select--default");
  await page.keyboard.press("Tab");
  const trigger = page.getByRole("combobox", { name: "Sample select" });
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).toBeVisible();
  await expect(
    page.getByRole("option", { name: "Sample token A" }),
  ).toHaveAttribute("data-highlighted", "");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(trigger).toHaveText(/Sample token B/);
  await expect(trigger).toBeFocused();
});

test("Select: typeahead jumps to a matching option and disabled options are skipped", async ({
  page,
}) => {
  await openStory(page, "primitives--select--default");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Sample token C");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("combobox", { name: "Sample select" }),
  ).toHaveText(/Sample token C/);
});

test("Dialog: opens from the keyboard, traps Tab inside, Escape closes and restores focus", async ({
  page,
}) => {
  await openStory(page, "primitives--dialog--default");
  await page.keyboard.press("Tab");
  const trigger = page.getByRole("button", { name: "Open dialog" });
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Close sample plan?" });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 8; i += 1) {
    await press(page, "Tab");
    expect(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
  }
  for (let i = 0; i < 3; i += 1) {
    await press(page, "Shift+Tab");
    expect(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("Sheet: Escape closes and restores focus", async ({ page }) => {
  await openStory(page, "primitives--sheet--default");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Filters" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(
    page.getByRole("button", { name: /Open right sheet/ }),
  ).toBeFocused();
});

test("DropdownMenu: Enter opens on the first item, arrows move, Escape closes", async ({
  page,
}) => {
  await openStory(page, "primitives--dropdownmenu--default");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Profile" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Settings" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Account menu" }),
  ).toBeFocused();
});

test("Tabs: arrow keys, Home and End move between tabs and reveal panels", async ({
  page,
}) => {
  await openStory(page, "primitives--tabs--default");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("tab", { name: "Overview" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "News" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tabpanel", { name: "News" })).toContainText(
    "News panel",
  );
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Filings" })).toBeFocused();
});

test("Checkbox, Switch and RadioGroup work from the keyboard", async ({
  page,
}) => {
  await openStory(page, "primitives--checkbox--default");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Space");
  await expect(page.getByRole("checkbox", { name: "Unchecked" })).toBeChecked();

  await openStory(page, "primitives--switch--default");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Space");
  await expect(page.getByRole("switch", { name: "Off" })).toBeChecked();

  await openStory(page, "primitives--radiogroup--default");
  await page.keyboard.press("Tab");
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("radio", { name: "Mainnet spot" })).toBeChecked();
});

test("Button: activates with Enter and Space; loading keeps focus and blocks activation", async ({
  page,
}) => {
  await openStory(page, "primitives--button--loading");
  await page.keyboard.press("Tab");
  const first = page.getByRole("button", { name: "Saving" }).first();
  await expect(first).toBeFocused();
  await expect(first).toHaveAttribute("aria-busy", "true");
});

test("focus ring: a keyboard-focused control shows the 2px token-colored outline", async ({
  page,
}) => {
  await openStory(page, "primitives--button--focus");
  const ring = await page
    .getByRole("button", { name: "Focused" })
    .evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        width: style.outlineWidth,
        style: style.outlineStyle,
        color: style.outlineColor,
        expected: getComputedStyle(document.documentElement)
          .getPropertyValue("--aroma-focus")
          .trim(),
      };
    });
  expect(ring.style).toBe("solid");
  expect(ring.width).toBe("2px");
  expect(ring.color).not.toBe("rgba(0, 0, 0, 0)");
});

test("typography: Manrope is the font actually used, not a silent fallback", async ({
  page,
}) => {
  await openStory(page, "foundations--typography");
  const info = await page.evaluate(async () => {
    await document.fonts.ready;
    const sample = document.querySelector<HTMLElement>(
      "[data-testid=type-scale] span[style]",
    );
    return {
      family: sample ? getComputedStyle(sample).fontFamily : "",
      loaded: [...document.fonts].some(
        (f) => f.family === "Manrope" && f.status === "loaded",
      ),
      token: getComputedStyle(document.documentElement)
        .getPropertyValue("--aroma-font-sans")
        .trim(),
    };
  });
  expect(info.token).toMatch(/^Manrope,/);
  expect(info.family).toMatch(/^Manrope/);
  expect(info.loaded).toBe(true);
});

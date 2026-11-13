import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export type Theme = "light" | "dark";
export const THEMES: readonly Theme[] = ["light", "dark"];

/** Set the saved theme before any script runs, exactly as a returning visitor would have it. */
export async function useTheme(page: Page, theme: Theme): Promise<void> {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await page.addInitScript((value) => {
    try {
      window.localStorage.setItem("aroma-theme", value);
    } catch {
      // ignore
    }
  }, theme);
}

/** WCAG 2.0/2.1/2.2 A + AA and best practice, on the whole page. Nothing is disabled. */
export async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags([
      "wcag2a",
      "wcag2aa",
      "wcag21a",
      "wcag21aa",
      "wcag22aa",
      "best-practice",
    ])
    .analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
  }));
  expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
}

/** One h1, one main landmark, and the theme actually applied. */
export async function expectPageBasics(
  page: Page,
  theme: Theme,
): Promise<void> {
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

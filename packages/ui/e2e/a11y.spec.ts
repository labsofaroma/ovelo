import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { openStory, storyIds, type Theme } from "./stories";

/**
 * axe over every story, in light and dark. Reduced motion is emulated so entry transitions
 * have settled and contrast is measured on final colors, not mid-fade.
 *
 * Rules switched off, each with a reason (nothing else is suppressed):
 * - region, landmark-one-main, page-has-heading-one: page-level rules. A story is a component
 *   fixture, not a page; the app's own pages get these from their layouts (checked in M3 by
 *   Lighthouse).
 */
const PAGE_LEVEL_RULES = [
  "region",
  "landmark-one-main",
  "page-has-heading-one",
];

test.use({ reducedMotion: "reduce" });

for (const theme of ["light", "dark"] as const satisfies readonly Theme[]) {
  for (const id of storyIds()) {
    test(`axe: ${id} (${theme})`, async ({ page }) => {
      await openStory(page, id, theme);
      await page.waitForTimeout(150);
      const results = await new AxeBuilder({ page })
        .withTags([
          "wcag2a",
          "wcag2aa",
          "wcag21a",
          "wcag21aa",
          "wcag22aa",
          "best-practice",
        ])
        .disableRules(PAGE_LEVEL_RULES)
        .analyze();
      const summary = results.violations.map(
        (v) =>
          `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
      );
      expect(summary, summary.join("\n")).toEqual([]);
    });
  }
}

test("control: the gate really detects a contrast failure", async ({
  page,
}) => {
  await openStory(page, "primitives--badge--default", "light");
  await page.evaluate(() => {
    const bad = document.createElement("p");
    bad.id = "deliberate-bad-contrast";
    bad.textContent = "Deliberately low contrast";
    bad.style.cssText = "color:#bbbbbb;background:#ffffff;font-size:16px";
    document.body.append(bad);
  });
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2aa"])
    .disableRules(PAGE_LEVEL_RULES)
    .analyze();
  const ids = results.violations.map((v) => v.id);
  expect(ids).toContain("color-contrast");
});

import { expect, test, type Page } from "@playwright/test";
import { openStory, storyIds } from "./stories";

/** Longest duration allowed under reduced motion: the token floor (0.01ms) with headroom. */
const FLOOR_SECONDS = 0.0001;

async function longestMotion(
  page: Page,
): Promise<{ seconds: number; where: string }> {
  return page.evaluate(() => {
    const parse = (value: string): number[] =>
      value.split(",").map((part) => {
        const v = part.trim();
        return v.endsWith("ms") ? parseFloat(v) / 1000 : parseFloat(v);
      });
    let worst = { seconds: 0, where: "" };
    for (const el of document.querySelectorAll("body, body *")) {
      const style = getComputedStyle(el);
      const durations = [
        ...parse(style.transitionDuration),
        ...parse(style.animationDuration),
      ];
      const active =
        style.animationName !== "none" || style.transitionProperty !== "none";
      if (!active) continue;
      for (const seconds of durations) {
        if (seconds > worst.seconds) {
          worst = {
            seconds,
            where: `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`,
          };
        }
      }
    }
    return worst;
  });
}

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  for (const id of storyIds()) {
    test(`no motion beyond the token floor: ${id}`, async ({ page }) => {
      await openStory(page, id);
      await page.waitForTimeout(100);
      const worst = await longestMotion(page);
      expect(
        worst.seconds,
        `${worst.where} runs ${worst.seconds}s`,
      ).toBeLessThanOrEqual(FLOOR_SECONDS);
    });
  }
});

test.describe("control: the check is not vacuous", () => {
  test("without the preference, motion tokens and components really animate", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openStory(page, "foundations--motion");
    await expect(page.getByTestId("duration-slow")).toHaveText("320ms");
    const worst = await longestMotion(page);
    expect(worst.seconds).toBeGreaterThan(0.1);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openStory(page, "foundations--motion");
    await expect(page.getByTestId("motion-mode")).toContainText("reduce");
    await expect(page.getByTestId("duration-slow")).toHaveText("0.01ms");
    expect((await longestMotion(page)).seconds).toBeLessThanOrEqual(
      FLOOR_SECONDS,
    );
  });
});

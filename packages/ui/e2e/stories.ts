import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";

export type Theme = "light" | "dark";

interface Meta {
  stories: Record<string, { filePath: string }>;
}

/** All story ids from the built workbench (dist/stories/meta.json). */
export function storyIds(): string[] {
  const path = resolve(import.meta.dirname, "../dist/stories/meta.json");
  const meta = JSON.parse(readFileSync(path, "utf8")) as Meta;
  return Object.keys(meta.stories).sort();
}

/** Opens one story in Ladle's chrome-free preview mode with a theme applied. */
export async function openStory(
  page: Page,
  id: string,
  theme: Theme = "light",
): Promise<void> {
  await page.goto(`/?story=${id}&mode=preview&theme=${theme}`);
  await page.waitForSelector("[data-storyloaded]", { state: "attached" });
  // Ladle sets data-storyloaded when its loading ring unmounts. Under React 19 the attribute can
  // already be present while the lazy story's Suspense fallback (the ring) is still on screen, so
  // also wait for the ring to go and the story to render. Without this, axe and keyboard checks
  // could run against the loading spinner instead of the story.
  await page.waitForFunction(() => {
    const root = document.getElementById("ladle-root");
    return (
      !!root &&
      root.childElementCount > 0 &&
      !root.querySelector(".ladle-ring-wrapper")
    );
  });
  await page.waitForFunction(
    () => document.documentElement.dataset.theme !== undefined,
  );
}

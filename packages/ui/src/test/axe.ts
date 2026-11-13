import { configureAxe } from "vitest-axe";

/**
 * Structural axe check for jsdom component fixtures.
 * - color-contrast is off because jsdom cannot compute layout or paint. Contrast is covered by
 *   the token test (src/tokens/contrast.test.ts) and by the real-browser run over every story
 *   (e2e/a11y.spec.ts).
 * - region is off because it is a page-level rule ("all content in a landmark"); an isolated
 *   component fixture is not a page. The browser run keeps it off for the same reason.
 */
export const axe = configureAxe({
  rules: {
    "color-contrast": { enabled: false },
    region: { enabled: false },
  },
});

import { describe, expect, it } from "vitest";
import { readCss, readThemeBlocks } from "../test/css";
import { COLOR_ROLES, DURATIONS } from "../stories/token-lists";

const blocks = readThemeBlocks();
const colorRoles = Object.keys(blocks.colors).filter(
  (name) =>
    /^--ovelo-(?!shadow|scrim)/.test(name) &&
    blocks.colors[name]?.startsWith("#"),
);

describe("tokens.css structure", () => {
  it("is dark only: one color block, no light or prefers-color-scheme variants", () => {
    const css = readCss("tokens.css").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/data-theme="light"/);
    expect(css).not.toMatch(/prefers-color-scheme/);
    expect(css.match(/--ovelo-bg:/g)).toHaveLength(1);
    expect(blocks.colors["color-scheme"] ?? css).toMatch(/color-scheme: dark/);
  });

  it("uses plain hex for every solid color role so contrast can be computed", () => {
    expect(colorRoles.length).toBeGreaterThanOrEqual(19);
    for (const name of colorRoles)
      expect(blocks.colors[name]).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("collapses every motion duration under prefers-reduced-motion", () => {
    const durations = Object.keys(blocks.root).filter((name) =>
      name.startsWith("--ovelo-duration-"),
    );
    expect(durations.length).toBeGreaterThan(5);
    for (const name of durations) {
      expect(blocks.reducedMotion[name], `${name} must be overridden`).toBe(
        "0.01ms",
      );
    }
    expect(Object.keys(blocks.reducedMotion).sort()).toEqual(
      [...durations].sort(),
    );
  });

  it("keeps the spacing scale aligned with Tailwind's 4px steps", () => {
    for (const step of [1, 2, 3, 4, 5, 6, 8, 12]) {
      expect(blocks.root[`--ovelo-space-${step}`]).toBe(
        `${(step * 0.25).toString()}rem`,
      );
    }
  });

  it("keeps token references acyclic: --ovelo-* never refers to Tailwind's --font-*", () => {
    // theme.css maps --font-sans to var(--ovelo-font-sans); referring back makes both invalid.
    const tokens = readCss("tokens.css");
    expect(tokens).not.toMatch(/var\(--font-/);
    expect(blocks.root["--ovelo-font-display"]).toMatch(/^Manrope,/);
    expect(blocks.root["--ovelo-font-sans"]).toMatch(/^Inter,/);
  });

  it("has no raw color values in theme.css (everything references a token)", () => {
    const theme = readCss("theme.css");
    expect(theme).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(theme).not.toMatch(/\brgb\(/);
  });

  it("keeps the Foundations page in step with tokens.css", () => {
    const solid = Object.keys(blocks.colors)
      .filter((n) => blocks.colors[n]?.startsWith("#"))
      .map((n) => n.replace("--ovelo-", ""));
    expect([...solid].sort()).toEqual([...COLOR_ROLES].sort());
    const durations = Object.keys(blocks.root)
      .filter((n) => n.startsWith("--ovelo-duration-"))
      .map((n) => n.replace("--ovelo-duration-", ""));
    expect([...durations].sort()).toEqual([...DURATIONS].sort());
  });
});

import { describe, expect, it } from "vitest";
import { readThemeBlocks } from "../test/css";

const blocks = readThemeBlocks();

function channel(value: number): number {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
export function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = ["bg", "surface", "raised"] as const;
const SOFT = ["accent-soft", "up-soft", "down-soft", "warning-soft"] as const;

/** [foreground, background, minimum ratio, where components use the pair]. 4.5 text, 3 UI. */
const PAIRS: ReadonlyArray<readonly [string, string, 3 | 4.5, string]> = [
  ...SURFACES.flatMap(
    (bg) =>
      [
        ["ink", bg, 4.5, "body text"],
        ["muted", bg, 4.5, "secondary text, placeholders, labels"],
        ["accent", bg, 4.5, "links, badge text, selected indicators"],
        ["up", bg, 4.5, "positive change text"],
        ["down", bg, 4.5, "negative change and error text"],
        ["border-strong", bg, 3, "input, select, checkbox, switch boundaries"],
        ["focus", bg, 3, "focus ring"],
      ] as const,
  ),
  ...SOFT.map((bg) => ["ink", bg, 4.5, "avatar fallback tile"] as const),
  ["accent", "accent-soft", 4.5, "accent Badge"],
  ["up", "up-soft", 4.5, "up Badge"],
  ["down", "down-soft", 4.5, "down Badge"],
  ["warning", "warning-soft", 4.5, "warning Badge"],
  ["warning", "bg", 4.5, "warning text"],
  ["warning", "surface", 4.5, "warning text"],
  ["accent-ink", "accent", 4.5, "primary Button"],
  ["accent-ink", "accent-hover", 4.5, "primary Button hover"],
  ["bg", "ink", 4.5, "Tooltip (inverse)"],
  ["bg", "down", 4.5, "danger Button"],
  [
    "accent",
    "raised",
    3,
    "Progress indicator on its track, Switch thumb track",
  ],
  ["ink", "raised", 3, "Switch thumb on the off track"],
  ["accent-ink", "accent", 3, "Checkbox mark, Switch thumb on the on track"],
];

describe.each(["light", "dark"] as const)(
  "WCAG AA contrast, %s theme",
  (theme) => {
    const tokens = theme === "light" ? blocks.light : blocks.darkAttribute;
    const color = (role: string): string => {
      const value = tokens[`--aroma-${role}`];
      if (!value) throw new Error(`missing token --aroma-${role}`);
      return value;
    };

    it.each(PAIRS)("%s on %s is at least %s:1 (%s)", (fg, bg, min) => {
      const ratio = contrast(color(fg), color(bg));
      expect(
        ratio,
        `${fg} on ${bg} = ${ratio.toFixed(2)}`,
      ).toBeGreaterThanOrEqual(min);
    });

    it("keeps --aroma-line decorative: it must not be the only boundary of a control", () => {
      // line is far below 3:1 by design; controls use border-strong. This pins that split.
      expect(contrast(color("line"), color("surface"))).toBeLessThan(3);
      expect(
        contrast(color("border-strong"), color("surface")),
      ).toBeGreaterThanOrEqual(3);
    });
  },
);

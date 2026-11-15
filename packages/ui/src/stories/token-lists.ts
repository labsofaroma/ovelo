/** Token names shown on the Foundations page. tokens.test.ts checks these against tokens.css. */
export const COLOR_ROLES = [
  "bg",
  "surface",
  "raised",
  "raised-2",
  "pill",
  "ink",
  "muted",
  "line",
  "border-strong",
  "accent",
  "accent-hover",
  "accent-ink",
  "accent-soft",
  "up",
  "up-soft",
  "down",
  "down-soft",
  "warning",
  "warning-soft",
  "focus",
] as const;

export const TEXT_SIZES = [
  ["micro", "11px"],
  ["caption", "12px"],
  ["small", "13px"],
  ["body", "14px"],
  ["title", "18px"],
  ["section", "22px"],
  ["page-mobile", "28px"],
  ["page", "36px"],
  ["display", "54px"],
] as const;

export const SPACES = [1, 2, 3, 4, 5, 6, 8, 12] as const;
export const RADII = [
  "badge",
  "tile",
  "control",
  "panel",
  "hero",
  "full",
] as const;
export const SHADOWS = ["raised", "float"] as const;
export const DURATIONS = [
  "instant",
  "fast",
  "base",
  "pop",
  "glide",
  "slow",
  "shimmer",
  "spin",
] as const;
export const Z_LAYERS = [
  "base",
  "sticky",
  "dropdown",
  "overlay",
  "modal",
  "popover",
  "toast",
  "tooltip",
  "skip-link",
] as const;

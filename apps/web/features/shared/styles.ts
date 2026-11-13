/**
 * Server-safe class recipes. `buttonVariants` in @aroma/ui lives in a "use client" module, so a
 * Server Component cannot read its strings; links that look like buttons use these instead.
 * Tokens only (same utilities as the Button primitive).
 */
const base =
  "inline-flex items-center justify-center gap-2 rounded-control border font-semibold leading-snug transition-colors motion-base focus-ring";

export const linkButton = {
  primary: `${base} min-h-(--aroma-control-height) px-4 text-small bg-accent text-accent-ink border-transparent hover:bg-accent-hover`,
  secondary: `${base} min-h-(--aroma-control-height) px-4 text-small bg-transparent text-ink border-border-strong hover:bg-raised`,
} as const;

export const textLink =
  "text-ink underline underline-offset-2 hover:text-accent focus-ring rounded-badge";

export const pageContainer =
  "mx-auto w-full max-w-(--aroma-content-max) px-(--aroma-gutter-mobile) md:px-(--aroma-gutter)";

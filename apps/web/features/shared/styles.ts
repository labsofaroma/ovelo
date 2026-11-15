/**
 * Server-safe class recipes. `buttonClassName` in @ovelo/ui lives in a "use client" module, so a
 * Server Component cannot call it; links that look like buttons use these instead. Tokens only,
 * the same utilities as the Button primitive (packages/ui/src/primitives/Button/Button.tsx):
 * pill shape, silver accent for the one main action.
 */
const base =
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-full border font-medium leading-snug tracking-[-0.01em] whitespace-nowrap transition-[color,background-color,border-color,filter] motion-base focus-ring";

const md = "min-h-(--ovelo-control-height) px-5 text-small";
const sm =
  "min-h-(--ovelo-control-height-compact) px-4 text-caption max-md:min-h-(--ovelo-control-height)";

const tone = {
  /** Button `solid`: the single silver action on a surface. */
  primary: "bg-accent text-accent-ink border-transparent hover:bg-accent-hover",
  /** Button `secondary`. */
  secondary:
    "bg-raised-2 text-ink border-line hover:bg-raised hover:border-border-strong",
  /** Button `primary`: the near-black pill with a light hairline (landing CTA). */
  pill: "bg-pill text-ink border-(--ovelo-pill-border) hover:brightness-125 hover:border-border-strong",
  /** Button `ghost`. */
  ghost:
    "bg-transparent text-muted border-transparent hover:bg-raised-2 hover:text-ink",
} as const;

type Tone = keyof typeof tone;

const recipe = (size: string) =>
  Object.fromEntries(
    Object.entries(tone).map(([key, value]) => [
      key,
      `${base} ${size} ${value}`,
    ]),
  ) as Record<Tone, string>;

/** Button-looking links at the default control height. */
export const linkButton = recipe(md);

/** The same at the compact (`sm`) size. */
export const linkButtonSmall = recipe(sm);

export const textLink =
  "rounded-badge text-ink underline decoration-border-strong underline-offset-4 transition-colors motion-base hover:text-accent-hover hover:decoration-current focus-ring";

export const pageContainer =
  "mx-auto w-full max-w-(--ovelo-content-max) px-(--ovelo-gutter-mobile) md:px-(--ovelo-gutter)";

/** The pill eyebrow above a page or section title (same as Section's and PageHeader's). */
export const eyebrowPill =
  "inline-flex w-fit items-center rounded-full border border-line bg-raised-2 px-3 py-1 text-caption font-medium text-ink";

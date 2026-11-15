/**
 * The Ovelo gem (the `OveloGlyph` of `@ovelo/ui`'s Brand) for `next/og` ImageResponse, which
 * cannot read CSS custom properties or `currentColor`, so colours are passed in. Used by the
 * social preview (/og.png) and the Apple touch icon, so every rendered logo is the same mark.
 */
export const BRAND_COLORS = {
  /** --ovelo-accent (light) */
  accent: "#426c2f",
  /** --ovelo-bg (light) */
  bg: "#f5f6f2",
  /** --ovelo-accent (dark): the lime used on the forest social card */
  lime: "#d5f478",
  forest: "#193c2b",
  cream: "#f6f5ef",
} as const;

export function BrandGlyphImage({
  height,
  color,
  facet,
}: {
  height: number;
  /** Gem fill and tail stroke. */
  color: string;
  /** Facet lines: the colour of whatever is behind the gem. */
  facet: string;
}) {
  return (
    <svg
      width={(height * 30) / 34}
      height={height}
      viewBox="0 0 30 34"
      fill="none"
    >
      <path d="M15 1L29 13L15 28L1 13L15 1Z" fill={color} />
      <path d="M15 1V28M1 13H29" stroke={facet} strokeWidth="1.5" />
      <path d="M15 28L20 33" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

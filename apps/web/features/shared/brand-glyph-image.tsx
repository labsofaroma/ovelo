import { OVELO_MARK_PATH } from "@ovelo/ui/brand-mark";

/**
 * The Ovelo mark (the `OveloGlyph` of `@ovelo/ui`'s Brand: the white mark, no tile) for
 * `next/og` ImageResponse, which cannot read CSS custom properties. Used by the social preview
 * (/og.png) and the Apple touch icon, so every rendered logo is the same mark.
 */
export const BRAND_COLORS = {
  /** --ovelo-bg: the near-black page */
  bg: "#030303",
  /** --ovelo-ink */
  ink: "#f4f4f6",
  /** --ovelo-muted */
  muted: "#a1a1a7",
} as const;

/** The white mark alone, `height` pixels square. */
export function BrandGlyphImage({ height }: { height: number }) {
  return (
    <svg width={height} height={height} viewBox="0 0 100 100" fill="none">
      <path fill="#fff" fillRule="evenodd" d={OVELO_MARK_PATH} />
    </svg>
  );
}

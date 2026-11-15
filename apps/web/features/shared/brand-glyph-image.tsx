import { OVELO_MARK_PATH, OVELO_TILE_GRADIENT } from "@ovelo/ui/brand-mark";

/**
 * The Ovelo mark (the `OveloGlyph` of `@ovelo/ui`'s Brand: white on its peach-to-pink tile) for
 * `next/og` ImageResponse, which cannot read CSS custom properties. Used by the social preview
 * (/og.png) and the Apple touch icon, so every rendered logo is the same mark.
 */
export const BRAND_COLORS = {
  /** --ovelo-bg (light) */
  bg: "#f5f6f2",
  /** --ovelo-accent (dark): the lime used on the forest social card */
  lime: "#d5f478",
  forest: "#193c2b",
  cream: "#f6f5ef",
  tileFrom: OVELO_TILE_GRADIENT.from,
  tileTo: OVELO_TILE_GRADIENT.to,
} as const;

/** CSS gradient of the tile, for a full-bleed background (the Apple icon). */
export const TILE_BACKGROUND = `linear-gradient(45deg, ${OVELO_TILE_GRADIENT.from}, ${OVELO_TILE_GRADIENT.to})`;

/**
 * `tile`: the mark on its rounded gradient tile (social card). Without it, the white mark alone,
 * for a surface that is already the gradient (the Apple icon).
 */
export function BrandGlyphImage({
  height,
  tile = true,
}: {
  height: number;
  tile?: boolean;
}) {
  return (
    <svg width={height} height={height} viewBox="0 0 32 32" fill="none">
      {tile && (
        <defs>
          <linearGradient
            id="ovelo-tile"
            x1="0"
            y1="32"
            x2="32"
            y2="0"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor={OVELO_TILE_GRADIENT.from} />
            <stop offset="1" stopColor={OVELO_TILE_GRADIENT.to} />
          </linearGradient>
        </defs>
      )}
      {tile && <rect width="32" height="32" rx="8" fill="url(#ovelo-tile)" />}
      <path
        transform={tile ? "translate(6 6) scale(0.2)" : "scale(0.32)"}
        fill="#fff"
        fillRule="evenodd"
        d={OVELO_MARK_PATH}
      />
    </svg>
  );
}

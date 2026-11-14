import { ImageResponse } from "next/og";
import { OG_SIZE } from "@/features/shared/og";

/**
 * GET /og.png: generated social preview for every v1 route (closes AUDIT L-2 for v1).
 *
 * A route handler rather than `opengraph-image.tsx`: inside a route group Next serves that file at
 * a hashed URL (`/opengraph-image-<hash>`), and both groups resolve to the same root, so pages in the
 * `(app)` group could not reference it. Here the URL is stable and `v1Metadata` points at it.
 *
 * A branded static design: no prices or figures, nothing that can go stale or be mistaken for
 * market data. Colours are the brand palette from .21st/DESIGN.md (forest, cream, lime);
 * ImageResponse cannot read CSS custom properties, so they are literal here.
 */
export const dynamic = "force-static";

const FOREST = "#193c2b";
const CREAM = "#f6f5ef";
const LIME = "#d5f478";

export function GET(): Response {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        background: FOREST,
        color: CREAM,
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            background: LIME,
            display: "flex",
          }}
        />
        <div style={{ fontSize: 48, fontWeight: 700, letterSpacing: -2 }}>
          aroma
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div
          style={{
            fontSize: 72,
            fontWeight: 700,
            lineHeight: 1.05,
            letterSpacing: -2,
          }}
        >
          Own real stocks from your own wallet.
        </div>
        <div style={{ fontSize: 32, color: LIME }}>
          Tokenized stocks and baskets on Solana · sourced market data
        </div>
      </div>
    </div>,
    OG_SIZE,
  );
}

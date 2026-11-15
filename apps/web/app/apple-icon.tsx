import { ImageResponse } from "next/og";
import {
  BRAND_COLORS,
  BrandGlyphImage,
} from "@/features/shared/brand-glyph-image";

/**
 * The iOS home-screen icon: the white Ovelo mark on the near-black page colour. iOS has no
 * transparent icons (it fills them black), so the page colour stands in for "no background".
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";
export const dynamic = "force-static";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: BRAND_COLORS.bg,
      }}
    >
      <BrandGlyphImage height={112} />
    </div>,
    size,
  );
}

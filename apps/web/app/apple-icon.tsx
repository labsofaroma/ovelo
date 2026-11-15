import { ImageResponse } from "next/og";
import {
  BRAND_COLORS,
  BrandGlyphImage,
} from "@/features/shared/brand-glyph-image";

/** The iOS home-screen icon: the Aroma gem on the light page colour (iOS rounds the corners). */
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
      <BrandGlyphImage
        height={120}
        color={BRAND_COLORS.accent}
        facet={BRAND_COLORS.bg}
      />
    </div>,
    size,
  );
}

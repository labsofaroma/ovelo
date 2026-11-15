import { ImageResponse } from "next/og";
import {
  BrandGlyphImage,
  TILE_BACKGROUND,
} from "@/features/shared/brand-glyph-image";

/** The iOS home-screen icon: the white Ovelo mark on the full-bleed tile gradient (iOS rounds the corners). */
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
        background: TILE_BACKGROUND,
      }}
    >
      <BrandGlyphImage height={112} tile={false} />
    </div>,
    size,
  );
}

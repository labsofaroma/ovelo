"use client";

import { Building2 } from "lucide-react";
import { useState, type ComponentType, type ImgHTMLAttributes } from "react";
import { cn } from "../../lib/cn";
import {
  fallbackTone,
  getCompanyLogo,
  isSafeLogoUrl,
  tickerOf,
  type LogoLookupAsset,
} from "./logo-lookup";

export type AssetAvatarSize = "sm" | "md" | "lg";

/** The subset of <img> props the avatar passes down; next/image satisfies it. */
export type AvatarImageProps = Pick<
  ImgHTMLAttributes<HTMLImageElement>,
  "src" | "alt" | "onError" | "loading" | "className" | "sizes"
> & { width: number; height: number; src: string; alt: string };

export interface AssetAvatarProps {
  asset: LogoLookupAsset & { logoUrl?: string | null };
  size?: AssetAvatarSize;
  /** Accessible name of the logo. Omit when the symbol is printed beside the avatar. */
  label?: string;
  /**
   * Image renderer. Defaults to a plain <img> (safe anywhere). Pass a thin wrapper around
   * next/image to get optimisation; the avatar itself never imports Next.
   */
  ImageComponent?: ComponentType<AvatarImageProps>;
  className?: string;
}

const BOX: Record<AssetAvatarSize, string> = {
  sm: "size-8 rounded-control text-micro",
  md: "size-9 rounded-xl text-micro max-md:size-8",
  lg: "size-15 rounded-panel text-title",
};
const PIXELS: Record<AssetAvatarSize, number> = { sm: 32, md: 40, lg: 64 };

/**
 * Token or stock icon. Logo order: bundled issuer logo (by mint, issuer, symbol), then the
 * supplied URL, then a deterministic ticker tile. Unsafe URLs and load failures fall back to
 * the tile, so the avatar never renders a broken image.
 */
export function AssetAvatar({
  asset,
  size = "md",
  label,
  ImageComponent,
  className,
}: AssetAvatarProps) {
  const [failed, setFailed] = useState<string | null>(null);
  const bundled = getCompanyLogo(asset);
  const candidate = bundled ?? asset.logoUrl;
  const logoUrl =
    isSafeLogoUrl(candidate) && failed !== candidate ? candidate : null;
  const Image = ImageComponent ?? "img";
  const px = PIXELS[size];

  return (
    <span
      title={label}
      data-size={size}
      data-fallback={logoUrl ? undefined : ""}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden border border-line font-semibold text-ink",
        BOX[size],
        logoUrl ? "bg-plate" : fallbackTone(asset.symbol),
        className,
      )}
    >
      {logoUrl ? (
        <Image
          src={logoUrl}
          alt={label ?? ""}
          width={px}
          height={px}
          loading="lazy"
          className="size-full object-contain"
          onError={() => setFailed(logoUrl)}
        />
      ) : size === "sm" ? (
        <Building2
          size={14}
          role="img"
          aria-label={label ?? "Company logo unavailable"}
        />
      ) : (
        <span aria-label={label} role={label ? "img" : undefined}>
          {tickerOf(asset)}
        </span>
      )}
    </span>
  );
}

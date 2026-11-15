"use client";

import Image from "next/image";
import type { AvatarImageProps } from "@ovelo/ui";
import { isAllowedImageUrl } from "../../../image-hosts.mjs";

/**
 * next/image adapter for AssetAvatar's `ImageComponent` slot (the UI package never imports Next).
 * Local issuer logos are already compressed webp, so they skip the optimizer. Same as the M1
 * `ui-preview` adapter, kept here so feature code does not import from a route folder.
 *
 * next/image THROWS during render for a remote host missing from `images.remotePatterns`, which
 * took down all of /markets when Jupiter served a logo from a new host. So only hosts in
 * image-hosts.mjs go through the optimizer; any other URL is rendered unoptimized, the CSP's
 * img-src blocks it, and AssetAvatar's onError falls back to the ticker tile.
 */
export function NextAvatarImage({
  src,
  alt,
  width,
  height,
  onError,
  loading,
  className,
}: AvatarImageProps) {
  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      unoptimized={src.startsWith("/") || !isAllowedImageUrl(src)}
      onError={onError}
      loading={loading ?? "lazy"}
      className={className}
    />
  );
}

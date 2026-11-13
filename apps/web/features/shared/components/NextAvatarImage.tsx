"use client";

import Image from "next/image";
import type { AvatarImageProps } from "@aroma/ui";

/**
 * next/image adapter for AssetAvatar's `ImageComponent` slot (the UI package never imports Next).
 * Local issuer logos are already compressed webp, so they skip the optimizer. Same as the M1
 * `ui-preview` adapter, kept here so feature code does not import from a route folder.
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
      unoptimized={src.startsWith("/")}
      onError={onError}
      loading={loading ?? "lazy"}
      className={className}
    />
  );
}

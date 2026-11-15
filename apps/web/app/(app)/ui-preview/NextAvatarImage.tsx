"use client";

import Image from "next/image";
import type { AvatarImageProps } from "@ovelo/ui";

/**
 * next/image adapter for AssetAvatar's `ImageComponent` slot (the UI package never imports
 * Next itself). Local issuer logos are already compressed webp, so they skip the optimizer.
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
      loading={loading}
      className={className}
    />
  );
}

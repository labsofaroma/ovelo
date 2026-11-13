import type { Metadata } from "next";
import { OG_IMAGE } from "./og";

export interface V1MetadataInput {
  title: string;
  description: string;
  /** Path of the page, e.g. "/v1/markets". Becomes the canonical URL (resolved on metadataBase). */
  path: string;
  noindex?: boolean;
}

/**
 * Per-page metadata for v1 routes. The root layout supplies `metadataBase` and the
 * "Aroma | %s" title template. `openGraph` is replaced (not merged) per page, which drops the
 * prototype's missing PNG in favour of the generated /v1/og.png (AUDIT L-2).
 */
export function v1Metadata({
  title,
  description,
  path,
  noindex = false,
}: V1MetadataInput): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    robots: noindex ? { index: false, follow: false } : undefined,
    openGraph: {
      type: "website",
      siteName: "Aroma",
      title: `Aroma | ${title}`,
      description,
      url: path,
      images: [OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: `Aroma | ${title}`,
      description,
      images: [OG_IMAGE],
    },
  };
}

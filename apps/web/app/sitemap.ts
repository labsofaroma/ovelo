import type { MetadataRoute } from "next";
import { SITEMAP_PATHS } from "../features/shared/routes";
import { siteUrl } from "../features/shared/site";

// Phase H: the site URL is read at request time (one self-host image serves beta and production).
export const dynamic = "force-dynamic";

/** Public, indexable pages (M9: at the root; the /v1 URLs redirect 308). */
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteUrl();
  return SITEMAP_PATHS.map((path) => ({
    url: new URL(path, origin).href,
    changeFrequency: "weekly",
    priority: path === "/" ? 1 : 0.6,
  }));
}

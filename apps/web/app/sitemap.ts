import type { MetadataRoute } from "next";
import { siteUrl } from "../lib/site";
import { V1_SITEMAP_PATHS } from "../features/shared/routes";
export default function sitemap(): MetadataRoute.Sitemap {
  // v1 routes are listed only when they exist (AROMA_V1_ENABLED=true, M3). M7 drops the prefix.
  const v1 = process.env.AROMA_V1_ENABLED?.trim() === "true" ? V1_SITEMAP_PATHS : [];
  return ["/", "/markets", "/baskets", "/privacy", "/terms", ...v1].map((path) => ({
    url: new URL(path, siteUrl()).href,
    changeFrequency: "weekly",
    priority: path === "/" ? 1 : 0.6,
  }));
}

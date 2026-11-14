import type { MetadataRoute } from "next";
import { siteUrl } from "../features/shared/site";

/** Index the public pages of the production site only; per-wallet and API paths never. */
export default function robots(): MetadataRoute.Robots {
  const origin = siteUrl();
  if (
    origin.hostname === "localhost" ||
    (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production")
  )
    return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/portfolio",
        "/watchlist",
        "/settings",
        "/restricted",
        "/basket/new",
      ],
    },
    sitemap: new URL("/sitemap.xml", origin).href,
  };
}

import type { MetadataRoute } from "next";
import { siteUrl } from "../features/shared/site";
import { productionRules } from "../server/platform";

// Phase H: one self-host image serves beta and production, so the answer is read at request
// time, not baked in at build (on Vercel the output is the same either way).
export const dynamic = "force-dynamic";

/** Index the public pages of production and beta only; per-wallet and API paths never. */
export default function robots(): MetadataRoute.Robots {
  const origin = siteUrl();
  if (origin.hostname === "localhost" || !productionRules(process.env))
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

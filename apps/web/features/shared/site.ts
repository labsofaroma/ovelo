import { vercelProductionHost } from "@/server/platform";

/**
 * The public site origin: metadataBase (canonical and OG URLs), robots and the sitemap (M9).
 * `AROMA_SITE_URL` (validated at boot, required in production by check:prod-env), else Vercel's
 * production host, else localhost. Throws on anything that is not a bare https origin (http only
 * on loopback), so a misconfigured deploy fails loudly instead of publishing the wrong host.
 */
export function siteUrl(
  env: Readonly<Record<string, string | undefined>> = process.env,
): URL {
  const configured =
    env.AROMA_SITE_URL ||
    (vercelProductionHost(env)
      ? `https://${vercelProductionHost(env)}`
      : "http://localhost:3000");
  const url = new URL(configured);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["https:", "http:"].includes(url.protocol) ||
    // Plain http only for a local run, as the boot schema allows (httpsUrl).
    (url.protocol === "http:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  )
    throw new Error("AROMA_SITE_URL must be a public site origin.");
  return new URL(url.origin);
}

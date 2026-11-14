/**
 * The public site origin for robots and the sitemap (M9 Step 1: moved here unchanged from the
 * prototype's lib/site.ts). `AROMA_SITE_URL`, else Vercel's production host, else localhost.
 * Throws on anything that is not a bare http(s) origin, so a misconfigured deploy fails loudly
 * instead of publishing a sitemap for the wrong host. Step 4 replaces the fallback with a
 * validated `AROMA_SITE_URL` from the env schema.
 */
export function siteUrl(
  env: Readonly<Record<string, string | undefined>> = process.env,
): URL {
  const configured =
    env.AROMA_SITE_URL ||
    (env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000");
  const url = new URL(configured);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["https:", "http:"].includes(url.protocol)
  )
    throw new Error("AROMA_SITE_URL must be a public site origin.");
  return new URL(url.origin);
}

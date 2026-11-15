/**
 * The one list of remote hosts that asset logos may come from (plain ESM so next.config.mjs can
 * import it). next.config.mjs `images.remotePatterns`, the CSP `img-src` (server/csp.ts) and the
 * next/image adapter (features/shared/components/NextAvatarImage.tsx) all read it, so a logo host
 * is allowed in all three places or in none.
 *
 * - xstocks-metadata.backed.fi: the xStocks issuer catalog (every xStock has a logo there).
 * - prestocks.com, backpack.exchange: the PreStocks and Backpack issuer catalogs.
 * - static.datapi.jup.ag: Jupiter Tokens V2 icons, used only when the issuer gives no logo.
 */
export const IMAGE_HOSTS = [
  "xstocks-metadata.backed.fi",
  "prestocks.com",
  "backpack.exchange",
  "static.datapi.jup.ag",
];

/** True for an https URL on one of IMAGE_HOSTS. Anything else is not a remote logo we serve. */
export function isAllowedImageUrl(src) {
  try {
    const url = new URL(src);
    return url.protocol === "https:" && IMAGE_HOSTS.includes(url.hostname);
  } catch {
    return false;
  }
}

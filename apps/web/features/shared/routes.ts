/**
 * Internal page routes. Build every internal link from these helpers. M9 Step 4: the pages moved
 * from the temporary `/v1` prefix to the root; next.config.mjs redirects the old URLs (308).
 */
export const routes = {
  home: "/",
  markets: "/markets",
  baskets: "/baskets",
  watchlist: "/watchlist",
  portfolio: "/portfolio",
  creators: "/creators",
  /** M7: recurring investing on devnet (test tokens). */
  invest: "/invest",
  builder: "/basket/new",
  privacy: "/privacy",
  terms: "/terms",
  settings: "/settings",
  stock: (symbol: string) => `/stock/${encodeURIComponent(symbol)}`,
  basket: (id: string) => `/basket/${encodeURIComponent(id)}`,
} as const;

/** Public, indexable routes (sitemap). The watchlist and portfolio are per-wallet, so not listed. */
export const SITEMAP_PATHS = [
  routes.home,
  routes.markets,
  routes.baskets,
  routes.creators,
  routes.privacy,
  routes.terms,
] as const;

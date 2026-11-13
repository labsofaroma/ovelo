/** Base path of the v1 routes until M7. Build every internal v1 link from these helpers. */
export const V1 = "/v1" as const;

export const routes = {
  home: V1,
  markets: `${V1}/markets`,
  baskets: `${V1}/baskets`,
  watchlist: `${V1}/watchlist`,
  privacy: `${V1}/privacy`,
  terms: `${V1}/terms`,
  stock: (symbol: string) => `${V1}/stock/${encodeURIComponent(symbol)}`,
  basket: (id: string) => `${V1}/basket/${encodeURIComponent(id)}`,
} as const;

/** Public, indexable v1 routes (sitemap). The watchlist is per-device, so it is not listed. */
export const V1_SITEMAP_PATHS = [
  routes.home,
  routes.markets,
  routes.baskets,
  routes.privacy,
  routes.terms,
] as const;

/**
 * M9 cutover: every old URL that moved, in one place (next.config.mjs `redirects()`, tested by
 * redirects.test.ts). `permanent: true` answers 308, which keeps the method and the query
 * string. Removed prototype APIs are not here: they answer 410 GONE (server/gone.ts).
 */
export const LEGACY_REDIRECTS = [
  // The v1 pages lived under a temporary /v1 prefix (M3 decision 1).
  { source: "/v1", destination: "/", permanent: true },
  { source: "/v1/:path*", destination: "/:path*", permanent: true },
  // Prototype page URLs whose v1 page has another path.
  { source: "/landing", destination: "/", permanent: true },
  { source: "/app", destination: "/markets", permanent: true },
  { source: "/sip", destination: "/invest", permanent: true },
  { source: "/basket/builder", destination: "/basket/new", permanent: true },
  { source: "/orders", destination: "/portfolio#activity", permanent: true },
];

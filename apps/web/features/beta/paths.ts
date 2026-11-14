/**
 * Which requests the private-beta gate covers (REWRITE-PLAN §7.3 W2). Pure and edge-safe.
 *
 * Every entry point that prepares or sends a mainnet purchase: the v1 quote and submit routes
 * (stock, basket and creator-basket buys all use them), the v1 Action POST that builds a
 * transaction, and the prototype's trading routes, which have no notion of beta access and are
 * therefore closed outright while the gate is on. Never gated: reads (GET/HEAD/OPTIONS), the
 * Action `/confirm` receipt callback, browsing, research, paper practice and the devnet
 * `/invest` routes.
 *
 * The path is normalised first (percent-decoding, repeated and trailing slashes, dot segments,
 * case), so a spelling variant can never route to a handler without being matched here.
 */
export type BetaEntry = "quote" | "submit" | "action" | "prototype";

const ENTRIES: readonly { pattern: RegExp; entry: BetaEntry }[] = [
  { pattern: /^\/api\/v1\/trade\/quote$/, entry: "quote" },
  { pattern: /^\/api\/v1\/trade\/submit$/, entry: "submit" },
  { pattern: /^\/api\/v1\/actions\/baskets\/[^/]+$/, entry: "action" },
  { pattern: /^\/api\/actions\//, entry: "prototype" },
  { pattern: /^\/api\/trade\//, entry: "prototype" },
  { pattern: /^\/api\/transaction\/execute$/, entry: "prototype" },
  { pattern: /^\/api\/bundles\/execute$/, entry: "prototype" },
  { pattern: /^\/api\/buy-basket$/, entry: "prototype" },
];

/** Canonical form used only for matching (never for routing). */
export function normalizePath(pathname: string): string {
  let path = pathname;
  for (let i = 0; i < 3; i++) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      break;
    }
    if (decoded === path) break;
    path = decoded;
  }
  path = path.replace(/\\/g, "/").toLowerCase();
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") out.pop();
    else out.push(segment);
  }
  return `/${out.join("/")}`;
}

export function betaEntry(pathname: string, method: string): BetaEntry | null {
  const verb = method.toUpperCase();
  if (verb === "GET" || verb === "HEAD" || verb === "OPTIONS") return null;
  const path = normalizePath(pathname);
  return ENTRIES.find((item) => item.pattern.test(path))?.entry ?? null;
}

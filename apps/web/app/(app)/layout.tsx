import type { ReactNode } from "react";

/**
 * v1 product shell (REWRITE-PLAN §4): markets, stock, baskets, invest, portfolio, activity,
 * watchlist, settings and creators. M0 ships only this empty layout so the route group exists.
 * It has no `page.tsx`, so it adds no route and renders nothing; the prototype routes keep
 * serving until M7. M1 adds the Shell, M3 the read-only pages, M4 the wallet providers.
 */
export default function AppGroupLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

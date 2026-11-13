import type { ReactNode } from "react";
import { themeInitScript } from "@aroma/ui/theme";
import "../aroma-ui.v4.css";

/**
 * v1 product shell (REWRITE-PLAN §4): markets, stock, baskets, invest, portfolio, activity,
 * watchlist, settings and creators. M0 shipped this empty layout so the route group exists;
 * M1 wires in @aroma/ui (Tailwind v4 entry + the no-flash theme script). M3 adds the Shell
 * and the read-only pages, M4 the wallet providers.
 *
 * Pages here are reachable only when AROMA_V1_ENABLED=true; the prototype keeps serving
 * everything else until M7.
 */
export default function AppGroupLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* Same key as the prototype's ThemeProvider, so a saved choice carries over. The root
          layout still carries its own inline copy; M3 swaps it for this one. */}
      <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      {children}
    </>
  );
}

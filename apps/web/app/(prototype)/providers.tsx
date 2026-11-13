"use client";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { AromaProvider } from "../../components/aroma/State";
const WalletProviders = dynamic(() => import("./wallet-providers"), {
  ssr: false,
  loading: () => (
    <main className="system-screen" aria-busy="true">
      <section>
        <p className="eyebrow">AROMA</p>
        <h1>Opening your workspace.</h1>
        <p className="muted">Connecting your market and wallet tools.</p>
      </section>
    </main>
  ),
});
export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const path = pathname || "";
  const isWorkspace =
    [
      "/app",
      "/markets",
      "/baskets",
      "/sip",
      "/portfolio",
      "/orders",
      "/watchlist",
      "/settings",
      "/creators",
    ].includes(path) ||
    path.startsWith("/stock/") ||
    path.startsWith("/basket/") ||
    path.startsWith("/creators/");

  // v1 routes (M3, /v1/*) read market data on the server and do not use the prototype's paper
  // state. AromaProvider polls /api/markets (~2 MB) on mount, so it is skipped there. Prototype
  // routes are unchanged. M7 removes this provider.
  if (path.startsWith("/v1")) return <>{children}</>;
  return (
    <AromaProvider>
      {isWorkspace ? <WalletProviders>{children}</WalletProviders> : children}
    </AromaProvider>
  );
}

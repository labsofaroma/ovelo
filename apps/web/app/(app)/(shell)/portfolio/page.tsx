import type { Metadata } from "next";
import { PortfolioIsland } from "@/features/portfolio/components/PortfolioIsland";
import { v1Metadata } from "@/features/shared/metadata";
import { routes } from "@/features/shared/routes";
import { pageContainer } from "@/features/shared/styles";

export const metadata: Metadata = v1Metadata({
  title: "Portfolio",
  description:
    "Your Solana wallet's tokenized-stock holdings, allocation and the orders you placed through Ovelo.",
  path: routes.portfolio,
  // Per wallet and per device: nothing to index.
  noindex: true,
});

export default function PortfolioPage() {
  // The h1 sits in the island's first card (redesign layout); it is server-rendered with the
  // idle (not connected) wallet state.
  return (
    <main id="main-content" className={`${pageContainer} py-8`}>
      <PortfolioIsland />
    </main>
  );
}

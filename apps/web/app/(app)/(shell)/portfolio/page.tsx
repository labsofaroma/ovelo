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
  return (
    <main
      id="main-content"
      className={`${pageContainer} flex flex-col gap-6 py-8`}
    >
      <div className="flex flex-col gap-1">
        <h1 className="text-page font-semibold max-md:text-page-mobile">
          Portfolio
        </h1>
        <p className="text-small text-muted">
          Mainnet holdings of your connected wallet. Values use observed token
          prices only; unpriced holdings are listed without a value.
        </p>
      </div>
      <PortfolioIsland />
    </main>
  );
}

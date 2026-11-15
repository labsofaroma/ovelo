import type { Metadata } from "next";
import { NetworkBadge } from "@ovelo/ui";
import { DevnetSection } from "@/features/invest/components/DevnetSection";
import { InvestIsland } from "@/features/invest/components/InvestIsland";
import { InvestUnavailable } from "@/features/invest/components/InvestUnavailable";
import { MainnetRecurringComing } from "@/features/invest/components/MainnetRecurringComing";
import { loadInvestPage } from "@/features/invest/page-data";
import { v1Metadata } from "@/features/shared/metadata";
import { routes } from "@/features/shared/routes";
import { pageContainer } from "@/features/shared/styles";
import { PageHeader } from "@/features/shell/PageHeader";
import { ClusterLabel } from "@/features/wallet/ClusterLabel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = v1Metadata({
  title: "Recurring investing (devnet)",
  description:
    "Test recurring investing on Solana devnet with test tokens: plans, installments and skipped periods, read from the chain.",
  path: routes.invest,
  noindex: true,
});

export default async function InvestPage() {
  const page = await loadInvestPage();
  const cluster = page.state === "ok" ? page.data.cluster : page.cluster;
  return (
    <main
      id="main-content"
      className={`${pageContainer} flex flex-col gap-4 md:gap-5`}
    >
      <PageHeader
        eyebrow="Invest"
        title="Recurring investing"
        description="A devnet test of automatic investing: each period one installment of test USD buys your chosen assets at the Pyth oracle price. Test tokens only; nothing here has real value."
        actions={
          cluster === "devnet" ? (
            <NetworkBadge kind="devnet-test" />
          ) : (
            <ClusterLabel cluster={cluster} />
          )
        }
      />
      <MainnetRecurringComing />
      <div data-testid="devnet-plans" className="flex flex-col gap-4 md:gap-5">
        {page.state === "ok" ? (
          <InvestIsland data={page.data} />
        ) : (
          <DevnetSection>
            <InvestUnavailable cluster={page.cluster} message={page.message} />
          </DevnetSection>
        )}
      </div>
    </main>
  );
}

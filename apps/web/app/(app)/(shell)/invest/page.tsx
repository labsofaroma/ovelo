import type { Metadata } from "next";
import { InvestIsland } from "@/features/invest/components/InvestIsland";
import { InvestUnavailable } from "@/features/invest/components/InvestUnavailable";
import { loadInvestPage } from "@/features/invest/page-data";
import { v1Metadata } from "@/features/shared/metadata";
import { routes } from "@/features/shared/routes";
import { pageContainer } from "@/features/shared/styles";

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
  return (
    <main
      id="main-content"
      className={`${pageContainer} flex flex-col gap-6 py-8`}
    >
      <div className="flex flex-col gap-1">
        <h1 className="text-page font-semibold max-md:text-page-mobile">
          Recurring investing
        </h1>
        <p className="text-small text-muted">
          A devnet test of automatic investing: each period one installment of
          test USD buys your chosen assets at the Pyth oracle price. Test tokens
          only; nothing here has real value.
        </p>
      </div>
      {page.state === "ok" ? (
        <InvestIsland data={page.data} />
      ) : (
        <InvestUnavailable cluster={page.cluster} message={page.message} />
      )}
    </main>
  );
}

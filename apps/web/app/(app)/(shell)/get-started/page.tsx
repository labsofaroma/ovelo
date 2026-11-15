import type { Metadata } from "next";
import { capsConfig, usd } from "@/features/caps/config";
import { getMarkets } from "@/features/markets/server";
import { onboardingCopy } from "@/features/onboarding/copy";
import { OnboardingIsland } from "@/features/onboarding/components/OnboardingIsland";
import type { Suggestion } from "@/features/onboarding/components/OnboardingSteps";
import { PageHeader } from "@/features/shell/PageHeader";
import { v1Metadata } from "@/features/shared/metadata";
import { routes } from "@/features/shared/routes";
import { pageContainer } from "@/features/shared/styles";
import { tradingOff } from "@/server/trading-switch";

export const dynamic = "force-dynamic";

export const metadata: Metadata = v1Metadata({
  title: onboardingCopy.title,
  description:
    "Connect your own Solana wallet, add a little SOL and USDC, and make a first purchase.",
  path: routes.getStarted,
});

/**
 * The suggested starting point: the available curated basket with the FEWEST tokens in today's
 * catalog (ties by name), because it needs the least SOL for token accounts. A fact-based rule,
 * stated on the page; never a recommendation, never a performance figure.
 */
async function suggestion(): Promise<Suggestion | null> {
  const markets = await getMarkets().catch(() => null);
  if (markets?.state !== "ok") return null;
  const [first] = markets.data.baskets
    .filter((b) => b.available && b.members.length > 0)
    .sort(
      (a, b) =>
        a.members.length - b.members.length || a.name.localeCompare(b.name),
    );
  return first
    ? { id: first.id, name: first.name, tokens: first.members.length }
    : null;
}

function capText(): string {
  try {
    return `${usd(capsConfig(process.env).perTrade)} per purchase`;
  } catch {
    return "a small amount per purchase";
  }
}

export default async function GetStartedPage() {
  const site = (process.env.OVELO_SITE_URL ?? "https://localhost").replace(
    /\/$/,
    "",
  );
  return (
    <main
      id="main-content"
      className={`${pageContainer} flex flex-col gap-4 py-8 md:gap-5`}
    >
      <PageHeader
        eyebrow={onboardingCopy.headerEyebrow}
        title={onboardingCopy.title}
        description={onboardingCopy.intro}
      />
      <OnboardingIsland
        suggestion={await suggestion()}
        capText={capText()}
        paused={tradingOff(process.env)}
        pageUrl={`${site}${routes.getStarted}`}
      />
    </main>
  );
}

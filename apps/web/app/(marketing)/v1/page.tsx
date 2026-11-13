import type { Metadata } from "next";
import { Landing } from "@/features/marketing/components/Landing";
import { getLandingSnapshot } from "@/features/marketing/server";
import { v1Metadata } from "@/features/shared/metadata";
import { routes } from "@/features/shared/routes";
import { assertV1Enabled } from "@/features/shared/v1";

/** M4: rendered per request (per-request CSP nonce); data comes from the Next data cache. */

export const metadata: Metadata = v1Metadata({
  title: "Own real stocks from your own wallet",
  description:
    "Research tokenized stocks and themed baskets on Solana with real, sourced market data. Every price shows its source and time.",
  path: routes.home,
});

export default async function LandingPage() {
  assertV1Enabled();
  return <Landing snapshot={await getLandingSnapshot()} />;
}

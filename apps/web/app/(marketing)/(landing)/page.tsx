import type { Metadata } from "next";
import { Landing } from "@/features/marketing/components/Landing";
import { v1Metadata } from "@/features/shared/metadata";
import { routes } from "@/features/shared/routes";

/** M4: rendered per request (per-request CSP nonce). The landing shows no market data. */

export const metadata: Metadata = v1Metadata({
  title: "Own real stocks from your own wallet",
  description:
    "Research tokenized stocks and themed baskets on Solana with real, sourced market data. Every price shows its source and time.",
  path: routes.home,
});

export default function LandingPage() {
  return <Landing />;
}

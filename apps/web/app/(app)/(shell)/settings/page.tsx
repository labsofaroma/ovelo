import type { Metadata } from "next";
import Link from "next/link";
import { NetworkBadge, Section, Stack, type NetworkKind } from "@ovelo/ui";
import { SettingsWallet } from "@/features/account/components/SettingsWallet";
import { SettingsRow } from "@/features/account/components/SettingsRow";
import { betaGateOn } from "@/features/beta/config";
import { NotificationsSettings } from "@/features/notifications/components/NotificationsSettings";
import { PrivacyChoicesButton } from "@/features/shared/components/PrivacyChoicesButton";
import { v1Metadata } from "@/features/shared/metadata";
import { routes } from "@/features/shared/routes";
import {
  linkButton,
  linkButtonSmall,
  pageContainer,
} from "@/features/shared/styles";
import { PageHeader } from "@/features/shell/PageHeader";
import { tradingOff } from "@/server/trading-switch";

export const dynamic = "force-dynamic";

export const metadata: Metadata = v1Metadata({
  title: "Settings",
  description:
    "Privacy choices, notifications, what is live on Ovelo, and your wallet's terms status.",
  path: routes.settings,
  // Per device and per wallet: nothing to index.
  noindex: true,
});

/** M9 Step 8: settings. Server-rendered facts from configuration; client islands for choices. */
export default function SettingsPage() {
  const paused = tradingOff(process.env);
  const beta = betaGateOn(process.env);
  const mainnet = paused
    ? "Paused by the operator. Nothing can be quoted or sent until it reopens."
    : beta
      ? "Open to invited wallets only (private beta), with per-trade and daily limits."
      : "Open, with per-trade and daily limits, where your location allows it.";
  const modes: { kind: NetworkKind; title: string; body: string }[] = [
    {
      kind: "mainnet-spot",
      title: "Mainnet spot purchase",
      body: `Real tokenized stocks bought on Solana mainnet from your own wallet. ${mainnet}`,
    },
    // Invest hidden: recurring is off the frontend until mainnet recurring ships (see _invest).
    // {
    //   kind: "devnet-test",
    //   title: "Devnet recurring test",
    //   body: "Recurring plans on Solana devnet with test tokens of no value. Not mainnet investing.",
    // },
    {
      kind: "paper",
      title: "Paper practice",
      body: "Simulated orders kept in this browser. No transaction, no funds.",
    },
  ];
  return (
    <main id="main-content" className={pageContainer}>
      <Stack>
        <PageHeader
          eyebrow="Settings"
          title="Settings"
          description="Your wallet, privacy choices, notifications and what each mode does."
        />

        <Section
          id="wallet"
          title="Wallet and terms"
          description="Ovelo never holds your keys or funds. Every transaction is signed in your own wallet."
        >
          <SettingsWallet />
        </Section>

        <Section id="modes" title="What each mode does">
          <dl className="flex flex-col">
            {modes.map((mode) => (
              <div
                key={mode.kind}
                className="flex flex-col gap-3 border-t border-line py-5 first:border-t-0 first:pt-0 last:pb-0 md:flex-row md:items-center md:justify-between md:gap-8"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <dt className="text-small font-semibold text-ink">
                    {mode.title}
                  </dt>
                  <dd className="text-small text-muted">{mode.body}</dd>
                </div>
                <NetworkBadge kind={mode.kind} className="shrink-0" />
              </div>
            ))}
          </dl>
        </Section>

        <Section id="notifications" title="Notifications">
          <NotificationsSettings />
        </Section>

        <Section
          id="privacy"
          title="Privacy"
          description="Essential storage keeps your preferences and watchlist on this device. Optional analytics run only if you allow them."
        >
          <SettingsRow
            title="Privacy choices"
            body="Change what this browser allows at any time."
          >
            <PrivacyChoicesButton className={linkButton.secondary} />
            <Link className={linkButton.ghost} href={routes.privacy}>
              Read the privacy policy
            </Link>
          </SettingsRow>
        </Section>

        <Section
          title="About Ovelo"
          description="Research tokenized stocks, build baskets and buy them from your own wallet on Solana. Nothing here is investment advice."
          actions={
            <>
              <Link className={linkButtonSmall.ghost} href={routes.terms}>
                Terms
              </Link>
              <Link className={linkButtonSmall.ghost} href={routes.privacy}>
                Privacy policy
              </Link>
            </>
          }
        />
      </Stack>
    </main>
  );
}

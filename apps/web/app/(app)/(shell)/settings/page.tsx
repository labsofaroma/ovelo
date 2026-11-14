import type { Metadata } from "next";
import { SettingsWallet } from "@/features/account/components/SettingsWallet";
import { betaGateOn } from "@/features/beta/config";
import { PrivacyChoicesButton } from "@/features/shared/components/PrivacyChoicesButton";
import { ThemeToggle } from "@/features/shared/components/ThemeToggle";
import { v1Metadata } from "@/features/shared/metadata";
import { routes } from "@/features/shared/routes";
import { pageContainer } from "@/features/shared/styles";
import { tradingOff } from "@/server/trading-switch";

export const dynamic = "force-dynamic";

export const metadata: Metadata = v1Metadata({
  title: "Settings",
  description:
    "Theme, privacy choices, what is live on Aroma, and your wallet's terms status.",
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
  return (
    <main
      id="main-content"
      className={`${pageContainer} flex max-w-3xl flex-col gap-8 py-8`}
    >
      <h1 className="text-page font-semibold max-md:text-page-mobile">
        Settings
      </h1>

      <section aria-labelledby="appearance" className="flex flex-col gap-2">
        <h2 id="appearance" className="text-section font-semibold">
          Appearance
        </h2>
        <div className="flex items-center gap-3 text-small">
          <ThemeToggle />
          <span className="text-muted">
            Light or dark, saved on this device.
          </span>
        </div>
      </section>

      <section aria-labelledby="privacy" className="flex flex-col gap-2">
        <h2 id="privacy" className="text-section font-semibold">
          Privacy
        </h2>
        <p className="text-small text-muted">
          Essential storage keeps your preferences and watchlist on this device.
          Optional analytics run only if you allow them.
        </p>
        <div className="text-small">
          <PrivacyChoicesButton />
        </div>
      </section>

      <section aria-labelledby="modes" className="flex flex-col gap-2">
        <h2 id="modes" className="text-section font-semibold">
          What each mode does
        </h2>
        <dl className="grid gap-3 text-small">
          <div>
            <dt className="font-semibold">Mainnet spot purchase</dt>
            <dd className="text-muted">
              Real tokenized stocks bought on Solana mainnet from your own
              wallet. {mainnet}
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Devnet recurring test</dt>
            <dd className="text-muted">
              Recurring plans on Solana devnet with test tokens of no value. Not
              mainnet investing.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Paper practice</dt>
            <dd className="text-muted">
              Simulated orders kept in this browser. No transaction, no funds.
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="wallet" className="flex flex-col gap-2">
        <h2 id="wallet" className="text-section font-semibold">
          Wallet and terms
        </h2>
        <SettingsWallet />
      </section>
    </main>
  );
}

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@aroma/ui";
import { useId } from "react";
import type { WalletState } from "../context";
import { CLUSTER_LABEL } from "../cluster";
import { onboardingCopy } from "../../onboarding/copy";
import { routes } from "../../shared/routes";
import { solNeededNote, WALLET_INSTALL_GUIDES } from "../onboarding";

/**
 * Wallet chooser built from packages/ui (no wallet-adapter-react-ui and its global CSS). Lists
 * only the Wallet Standard wallets the browser exposes (and Mobile Wallet Adapter on Android),
 * on every cluster. Wallet-only login (REWRITE-PLAN §7.3 W1): no embedded or email option, so
 * users bring their own wallet; the install guides and the SOL note help them get one.
 */
export function WalletPicker({
  open,
  onOpenChange,
  state,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: WalletState;
}) {
  const installed = state.options.filter((option) => option.ready);
  const guidesId = useId();
  const testCluster = CLUSTER_LABEL[state.cluster];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel="Close wallet picker">
        <DialogTitle>Connect a Solana wallet</DialogTitle>
        <DialogDescription>
          {testCluster ? `${testCluster}. ` : "Solana mainnet. "}
          Aroma prepares each transaction; your wallet signs it. Aroma never
          sees your keys.
        </DialogDescription>
        <ul className="mt-4 grid gap-2" aria-label="Installed wallets">
          {installed.map((option) => (
            <li key={option.name}>
              <Button
                variant="secondary"
                fullWidth
                onClick={() => state.select(option.name)}
                className="justify-start"
              >
                {option.icon ? (
                  // Wallet icons are data URIs supplied by the wallet itself.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={option.icon} alt="" width={20} height={20} />
                ) : null}
                {option.name}
              </Button>
            </li>
          ))}
        </ul>
        {installed.length === 0 ? (
          <p className="mt-4 text-small text-muted">
            No Solana wallet was found in this browser. Install one, then reload
            this page, or open Aroma in your wallet app&apos;s browser.
          </p>
        ) : null}
        <section className="mt-4 grid gap-2" aria-labelledby={guidesId}>
          <h3 id={guidesId} className="text-small font-semibold">
            {installed.length === 0 ? "Get a wallet" : "Need another wallet?"}
          </h3>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-small">
            {WALLET_INSTALL_GUIDES.map((guide) => (
              <li key={guide.name}>
                <a
                  href={guide.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  Install {guide.name}
                </a>
              </li>
            ))}
          </ul>
          {state.cluster === "mainnet" ? (
            <p className="text-small text-muted" data-testid="sol-needed">
              {solNeededNote()}
            </p>
          ) : null}
          {/* M11: the step-by-step onboarding page. */}
          <p className="text-small">
            <a href={routes.getStarted} className="underline">
              {onboardingCopy.pickerLink}
            </a>
          </p>
        </section>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { QueryProvider } from "../../shared/components/QueryProvider";
import { useWallet } from "../../wallet/context";
import { WalletBoundary } from "../../wallet/WalletBoundary";
import { useOnboarding } from "../useOnboarding";
import { OnboardingSteps, type Suggestion } from "./OnboardingSteps";

/** /get-started client island: data from hooks, view in OnboardingSteps. */
export function OnboardingIsland(props: {
  suggestion: Suggestion | null;
  capText: string;
  paused: boolean;
  pageUrl: string;
}) {
  return (
    <QueryProvider>
      <WalletBoundary>
        <Connected {...props} />
      </WalletBoundary>
    </QueryProvider>
  );
}

function Connected(props: {
  suggestion: Suggestion | null;
  capText: string;
  paused: boolean;
  pageUrl: string;
}) {
  const wallet = useWallet();
  const address = wallet.signer?.address ?? null;
  const funds = useOnboarding(address, props.suggestion?.tokens ?? 1);
  return <OnboardingSteps address={address} funds={funds} {...props} />;
}

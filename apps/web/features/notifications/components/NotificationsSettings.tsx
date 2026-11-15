"use client";

import { QueryProvider } from "../../shared/components/QueryProvider";
import { useSigner } from "../../wallet/context";
import { WalletBoundary } from "../../wallet/WalletBoundary";
import { useNotifications } from "../useNotifications";
import { NotificationsPanel } from "./NotificationsPanel";

/** /settings Notifications section (M11 Step 1): data from the hook, view in the panel. */
export function NotificationsSettings() {
  return (
    <QueryProvider>
      <WalletBoundary>
        <Connected />
      </WalletBoundary>
    </QueryProvider>
  );
}

function Connected() {
  const signer = useSigner();
  const state = useNotifications(signer);
  return (
    <NotificationsPanel
      wallet={signer?.address ?? null}
      canSign={Boolean(signer?.signMessage)}
      state={state}
    />
  );
}

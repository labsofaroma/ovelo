"use client";

import { Button } from "@ovelo/ui";
import { formatObservedAt } from "../../shared/freshness";
import { QueryProvider } from "../../shared/components/QueryProvider";
import { ConnectButton } from "../../wallet/ConnectButton";
import { useSigner } from "../../wallet/context";
import { WalletBoundary } from "../../wallet/WalletBoundary";
import { dashboardCopy as copy } from "../copy";
import { useArchiveMutation } from "../queries";
import { useDashboard } from "../useDashboard";
import type { DashboardData } from "../dashboard-schema";
import { BasketDashboardCard } from "./BasketDashboardCard";

/** /creators/dashboard client island (M11 Step 4). */
export function DashboardIsland({ origin }: { origin: string }) {
  return (
    <QueryProvider>
      <WalletBoundary>
        <Connected origin={origin} />
      </WalletBoundary>
    </QueryProvider>
  );
}

function Connected({ origin: configured }: { origin: string }) {
  const signer = useSigner();
  // OVELO_SITE_URL when set; otherwise this page's own origin (rendered only after sign-in).
  const origin =
    configured || (typeof window === "undefined" ? "" : window.location.origin);
  const dashboard = useDashboard(signer);
  const archive = useArchiveMutation(signer);
  return (
    <DashboardView
      wallet={signer?.address ?? null}
      canSign={Boolean(signer?.signMessage)}
      state={dashboard}
      origin={origin}
      onArchive={(id) =>
        archive.mutate(id, { onSuccess: () => dashboard.refresh() })
      }
      archivingId={archive.isPending ? (archive.variables ?? null) : null}
    />
  );
}

/** Pure view: tested without a wallet or network. */
export function DashboardView({
  wallet,
  canSign,
  state,
  origin,
  onArchive,
  archivingId,
}: {
  wallet: string | null;
  canSign: boolean;
  state: {
    data: DashboardData | null;
    error: { code: string; message: string } | null;
    busy: boolean;
    open: () => void;
    signedIn: boolean;
  };
  origin: string;
  onArchive: (id: string) => void;
  archivingId: string | null;
}) {
  if (!wallet)
    return (
      <div className="flex flex-col items-start gap-3 text-small">
        <p>{copy.connect}</p>
        <ConnectButton />
      </div>
    );
  if (!canSign)
    return <p className="text-small text-muted">{copy.cannotSign}</p>;
  if (state.error?.code === "FORBIDDEN")
    return <p className="text-small">{copy.notCreator}</p>;
  if (!state.data)
    return (
      <div className="flex flex-col items-start gap-2 text-small">
        <Button onClick={state.open} loading={state.busy}>
          {copy.open}
        </Button>
        <p className="text-muted">{copy.openHint}</p>
        {state.error ? (
          <p role="alert" className="text-down">
            {state.error.message}
          </p>
        ) : null}
      </div>
    );
  const data = state.data;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-caption text-muted">
        {copy.source(data.source, formatObservedAt(data.asOf) ?? data.asOf)}{" "}
        {copy.blinkNote(
          formatObservedAt(data.blinkTrackingSince) ?? data.blinkTrackingSince,
        )}
      </p>
      {data.baskets.length === 0 ? (
        <p className="text-small">{copy.noBaskets}</p>
      ) : null}
      {data.baskets.map((basket) => (
        <BasketDashboardCard
          key={basket.id}
          basket={basket}
          origin={origin}
          onArchive={onArchive}
          archiving={archivingId === basket.id}
        />
      ))}
      {state.error ? (
        <p role="alert" className="text-small text-down">
          {state.error.message}
        </p>
      ) : null}
    </div>
  );
}

"use client";

import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@aroma/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { QueryProvider } from "../../shared/components/QueryProvider";
import { TradeTicket } from "../../trade/components/TradeTicket";
import type { TradeTarget } from "../../trade/useTradeFlow";
import { useWallet } from "../../wallet/context";
import { WalletBoundary } from "../../wallet/WalletBoundary";
import { flowErrorMessage, UNSUPPORTED_WALLET } from "../publish-flow";
import { useArchiveMutation } from "../queries";
import { creatorRoutes } from "../routes";

type Props = {
  /** Null when the basket cannot be bought right now (the page explains why). */
  target: TradeTarget | null;
  title: string;
  basket: { id: string; name: string; creatorWallet: string };
};

/**
 * One wallet boundary for a published creator basket: the M4 trade ticket, and, for the creator
 * wallet only, "publish a new version" and "archive" (signed messages, never transactions).
 */
export function CreatorBasketIsland({ target, title, basket }: Props) {
  return (
    <QueryProvider>
      <WalletBoundary>
        {target ? <TradeTicket target={target} title={title} /> : null}
        <OwnerActions basket={basket} />
      </WalletBoundary>
    </QueryProvider>
  );
}

function OwnerActions({ basket }: { basket: Props["basket"] }) {
  const wallet = useWallet();
  const signer = wallet.status === "connected" ? wallet.signer : null;
  const archive = useArchiveMutation(signer);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  if (!signer || signer.address !== basket.creatorWallet) return null;

  return (
    <section
      aria-labelledby="owner-actions"
      className="mt-6 flex flex-col gap-3 rounded-panel border border-line bg-surface p-4"
    >
      <h2 id="owner-actions" className="text-title font-semibold">
        Manage your basket
      </h2>
      {archive.isSuccess ? (
        <p role="status" className="text-small">
          Archived. It can no longer be bought; past purchases and their
          receipts are kept.
        </p>
      ) : (
        <>
          <p className="text-small text-muted">
            You published this basket with this wallet. A new version replaces
            the weights buyers get from now on; earlier versions stay on record.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href={creatorRoutes.edit(basket.id)}
              className="inline-flex min-h-(--aroma-control-height) items-center rounded-control border border-line px-4 text-small font-semibold focus-ring hover:bg-raised"
            >
              Publish a new version
            </Link>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger
                render={
                  <Button variant="danger" disabled={!signer.signMessage}>
                    Archive basket
                  </Button>
                }
              />
              <DialogContent>
                <DialogTitle>Archive {basket.name}?</DialogTitle>
                <DialogDescription>
                  Buyers will no longer be able to buy it, and it leaves the
                  creator directory. Past purchases and receipts are kept.
                  Archiving cannot be undone. Your wallet will ask you to sign a
                  message; no funds move.
                </DialogDescription>
                <p
                  role="status"
                  aria-live="polite"
                  className="text-caption text-muted"
                >
                  {archive.isPending
                    ? archive.step.step === "signing"
                      ? "Confirm in your wallet."
                      : "Archiving…"
                    : ""}
                </p>
                {archive.isError ? (
                  <p role="alert" className="text-small text-down">
                    {flowErrorMessage(archive.error)}
                  </p>
                ) : null}
                <DialogFooter>
                  <DialogClose
                    render={<Button variant="ghost">Cancel</Button>}
                  />
                  <Button
                    variant="danger"
                    loading={archive.isPending}
                    onClick={() =>
                      archive.mutate(basket.id, {
                        onSuccess: () => {
                          setOpen(false);
                          router.refresh();
                        },
                      })
                    }
                  >
                    Sign and archive
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          {!signer.signMessage ? (
            <p role="alert" className="text-small text-down">
              {UNSUPPORTED_WALLET}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

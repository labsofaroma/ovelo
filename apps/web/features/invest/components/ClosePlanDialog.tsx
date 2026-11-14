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
import { useState } from "react";
import { useSigner } from "../../wallet/context";
import { investApi } from "../api";
import { useSignedPlanFlow } from "../queries";

/** Close + revoke in one transaction, then the result read back from chain by the server. */
export function ClosePlanDialog({
  plan,
  cluster,
}: {
  plan: string;
  cluster: "devnet" | "localnet";
}) {
  const signer = useSigner();
  const [open, setOpen] = useState(false);
  // The result stays on screen; the list refreshes when the dialog is dismissed.
  const flow = useSignedPlanFlow({ cluster, signer, refreshOnDone: false });
  const { state } = flow;
  const busy =
    state.step === "preparing" ||
    state.step === "signing" ||
    state.step === "submitting";
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && signer)
          flow.start(() => investApi.prepareClose(plan, signer.address));
        if (!next) {
          if (state.step === "done") void flow.refresh();
          flow.reset();
        }
      }}
    >
      <DialogTrigger
        render={
          <Button
            variant="secondary"
            size="sm"
            data-testid="close-plan"
            disabled={!signer}
          >
            Close plan
          </Button>
        }
      />
      <DialogContent>
        <DialogTitle>Close this plan and revoke its approval</DialogTitle>
        <DialogDescription>
          One transaction closes the plan, returns its rent and anything held
          between legs to your wallet, and revokes the recurring approval.
        </DialogDescription>
        {state.step === "review" ||
        state.step === "signing" ||
        state.step === "submitting" ? (
          <ul className="flex list-disc flex-col gap-1 pl-5 text-small">
            {state.prepared.summary.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        {state.step === "done" ? (
          <ul
            data-testid="close-result"
            role="status"
            className="flex flex-col gap-1 text-small"
          >
            {state.result.result.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        <p role="status" aria-live="polite" className="text-caption text-muted">
          {state.step === "preparing"
            ? "Preparing and simulating…"
            : state.step === "signing"
              ? "Confirm the transaction in your wallet."
              : state.step === "submitting"
                ? "Submitting and waiting for confirmation…"
                : ""}
        </p>
        {state.step === "error" ? (
          <p role="alert" className="text-small text-down">
            {state.message}
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose
            render={
              <Button variant="ghost">
                {state.step === "done" ? "Done" : "Cancel"}
              </Button>
            }
          />
          {state.step === "done" ? null : (
            <Button
              variant="danger"
              data-testid="close-confirm"
              loading={busy}
              disabled={state.step !== "review"}
              onClick={() =>
                state.step === "review" && flow.confirm(state.prepared)
              }
            >
              Sign, close and revoke
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

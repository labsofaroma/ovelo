import { Badge, Button } from "@ovelo/ui";
import { ExternalLink } from "lucide-react";
import type { FlowState } from "../flow";

/** In-flight and final states. "Unknown" is never shown as failed: it may have landed. */
const explorer = (signature: string) => `https://solscan.io/tx/${signature}`;

function Signatures({ signatures }: { signatures: readonly string[] }) {
  if (!signatures.length) return null;
  return (
    <ul className="flex flex-col gap-2 text-small">
      {signatures.map((signature) => (
        <li key={signature}>
          <a
            className="focus-ring inline-flex w-fit items-center gap-1 rounded-full font-medium break-all text-ink underline-offset-4 hover:underline"
            href={explorer(signature)}
            target="_blank"
            rel="noreferrer"
          >
            View transaction {signature.slice(0, 8)}… on Solscan
            <ExternalLink aria-hidden="true" className="size-3 shrink-0" />
          </a>
        </li>
      ))}
    </ul>
  );
}

export function TradeStatus({
  state,
  onReset,
}: {
  state: FlowState;
  onReset: () => void;
}) {
  if (state.step === "signing")
    return (
      <p
        role="status"
        className="flex flex-col gap-3 rounded-tile border border-line bg-raised p-4 text-small leading-body text-ink"
      >
        Approve the transaction in your wallet…
      </p>
    );
  if (state.step === "submitting")
    return (
      <p
        role="status"
        className="flex flex-col gap-3 rounded-tile border border-line bg-raised p-4 text-small leading-body text-ink"
      >
        Submitting to Solana mainnet…
      </p>
    );
  if (state.step === "confirming")
    return (
      <div
        role="status"
        className="flex flex-col gap-3 rounded-tile border border-line bg-raised p-4 text-small leading-body text-ink"
      >
        <Badge tone="warning" className="w-fit">
          Confirming
        </Badge>
        <p>
          Submitted. Waiting for mainnet confirmation; this page keeps checking,
          even after a refresh. Do not place the same order again while it is
          pending.
        </p>
        <Signatures signatures={state.record?.signatures ?? []} />
      </div>
    );
  if (state.step === "done") {
    const tone =
      state.outcome === "confirmed" || state.outcome === "paper"
        ? "up"
        : state.outcome === "failed"
          ? "down"
          : "warning";
    const text = {
      confirmed: "Confirmed on Solana mainnet.",
      failed:
        state.record?.error?.message ??
        "The transaction failed on chain; its asset changes were rolled back.",
      unknown:
        "Confirmation is unknown. This purchase may have completed: check your wallet activity before placing another order.",
      paper:
        "Paper order filled. This was practice: no transaction was created.",
    }[state.outcome];
    return (
      <div
        role="status"
        className="flex flex-col gap-3 rounded-tile border border-line bg-raised p-4 text-small leading-body text-ink"
      >
        <Badge tone={tone} className="w-fit">
          {state.outcome === "paper" ? "Paper" : state.outcome}
        </Badge>
        <p>{text}</p>
        <Signatures signatures={state.record?.signatures ?? []} />
        <Button
          className="w-fit"
          variant="secondary"
          size="sm"
          onClick={onReset}
        >
          New order
        </Button>
      </div>
    );
  }
  if (state.step === "error")
    return (
      <div
        role="alert"
        className="flex flex-col gap-3 rounded-tile bg-down-soft px-4 py-3 text-small leading-body text-down"
      >
        <p>{state.error.message}</p>
        <Button
          className="w-fit"
          variant="secondary"
          size="sm"
          onClick={onReset}
        >
          Start over
        </Button>
      </div>
    );
  return null;
}

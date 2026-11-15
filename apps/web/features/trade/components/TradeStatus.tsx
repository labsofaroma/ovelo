import { Badge, Button } from "@ovelo/ui";
import type { FlowState } from "../flow";

/** In-flight and final states. "Unknown" is never shown as failed: it may have landed. */
const explorer = (signature: string) => `https://solscan.io/tx/${signature}`;

function Signatures({ signatures }: { signatures: readonly string[] }) {
  if (!signatures.length) return null;
  return (
    <ul className="mt-2 grid gap-1 text-small">
      {signatures.map((signature) => (
        <li key={signature}>
          <a
            className="break-all underline focus-ring"
            href={explorer(signature)}
            target="_blank"
            rel="noreferrer"
          >
            View transaction {signature.slice(0, 8)}… on Solscan
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
      <p role="status" className="mt-4 text-small">
        Approve the transaction in your wallet…
      </p>
    );
  if (state.step === "submitting")
    return (
      <p role="status" className="mt-4 text-small">
        Submitting to Solana mainnet…
      </p>
    );
  if (state.step === "confirming")
    return (
      <div role="status" className="mt-4 text-small">
        <Badge tone="warning">Confirming</Badge>
        <p className="mt-2">
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
      <div role="status" className="mt-4 text-small">
        <Badge tone={tone}>
          {state.outcome === "paper" ? "Paper" : state.outcome}
        </Badge>
        <p className="mt-2">{text}</p>
        <Signatures signatures={state.record?.signatures ?? []} />
        <Button
          className="mt-3"
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
        className="mt-4 rounded-control bg-down-soft p-3 text-small text-down"
      >
        <p>{state.error.message}</p>
        <Button
          className="mt-2"
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

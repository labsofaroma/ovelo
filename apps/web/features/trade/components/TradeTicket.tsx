import { Badge, Button } from "@aroma/ui";
import { useId, useState } from "react";
// --- M9 compliance gate (additive) ---
import { TradeComplianceGate } from "../../compliance/components/TradeComplianceGate";
import { useComplianceRefresh } from "../../compliance/queries";
// --- end M9 compliance gate ---
import { ConnectButton } from "../../wallet/ConnectButton";
import { useWallet } from "../../wallet/context";
import { FUNDING_TOKENS } from "../schema";
import { useTradeFlow, type TradeTarget } from "../useTradeFlow";
import { ReviewPanel } from "./ReviewPanel";
import { TradeStatus } from "./TradeStatus";

/**
 * Buy ticket for one stock or one basket (replaces M3's "Trade (coming soon)"). Two clearly
 * labelled channels (PRODUCT.md): a MAINNET spot purchase signed by the user's wallet, or PAPER
 * practice that never creates a transaction. Funding: USDC, USDT or SOL.
 */
export function TradeTicket({
  target,
  title,
}: {
  target: TradeTarget;
  title: string;
}) {
  const ids = { amount: useId(), funding: useId(), heading: useId() };
  const wallet = useWallet();
  const flow = useTradeFlow(target);
  const [channel, setChannel] = useState<"live" | "paper">("live");
  const [amount, setAmount] = useState("");
  const [funding, setFunding] = useState<string>(FUNDING_TOKENS[0].mint);
  const { state } = flow;
  const editing = state.step === "idle" || state.step === "error";
  const symbol =
    channel === "paper"
      ? "USD"
      : (FUNDING_TOKENS.find((t) => t.mint === funding)?.symbol ?? "");

  // M9 compliance gate (additive): a gate refusal re-reads the status so the ticket shows why.
  useComplianceRefresh(state.step === "error" ? state.error.code : null);

  const requestQuote = () =>
    void flow.quote({ channel, amount: amount.trim(), inputMint: funding });

  return (
    <section
      aria-labelledby={ids.heading}
      className="rounded-panel border border-line bg-surface p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={ids.heading} className="text-section font-semibold">
          {title}
        </h2>
        {channel === "live" ? <ConnectButton /> : null}
      </div>
      <fieldset className="mt-3" disabled={!editing}>
        <legend className="sr-only">Order type</legend>
        <div className="flex gap-2" role="radiogroup" aria-label="Order type">
          {(
            [
              ["live", "Mainnet spot purchase"],
              ["paper", "Paper practice"],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className="flex cursor-pointer items-center gap-2 rounded-control border border-border-strong px-3 py-2 text-small has-[:checked]:bg-accent-soft"
            >
              <input
                type="radio"
                name={`${ids.heading}-channel`}
                value={value}
                checked={channel === value}
                onChange={() => setChannel(value)}
              />
              {label}
            </label>
          ))}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
          <div>
            <label htmlFor={ids.amount} className="text-small font-semibold">
              Amount ({symbol})
            </label>
            <input
              id={ids.amount}
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full rounded-control border border-border-strong bg-bg px-3 py-2 tabular-nums focus-ring"
              placeholder="0.00"
            />
          </div>
          {channel === "live" ? (
            <div>
              <label htmlFor={ids.funding} className="text-small font-semibold">
                Pay with
              </label>
              <select
                id={ids.funding}
                value={funding}
                onChange={(e) => setFunding(e.target.value)}
                className="mt-1 w-full rounded-control border border-border-strong bg-bg px-3 py-2 focus-ring"
              >
                {FUNDING_TOKENS.map((token) => (
                  <option key={token.mint} value={token.mint}>
                    {token.symbol}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
      </fieldset>
      {editing ? (
        // M9 compliance gate (additive): location, then terms, before a mainnet quote.
        <TradeComplianceGate
          live={channel === "live" && wallet.status === "connected"}
          signer={wallet.signer}
        >
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              onClick={requestQuote}
              disabled={
                !amount.trim() ||
                (channel === "live" && wallet.status !== "connected")
              }
            >
              Get quote
            </Button>
            {channel === "live" && wallet.status !== "connected" ? (
              <span className="text-small text-muted">
                Connect a mainnet wallet to get a signable quote.
              </span>
            ) : null}
            {channel === "paper" ? (
              <Badge tone="neutral">Practice: no transaction is created</Badge>
            ) : null}
          </div>
        </TradeComplianceGate>
      ) : null}
      {state.step === "quoting" ? (
        <p role="status" className="mt-4 text-small">
          {channel === "live"
            ? "Finding a route and simulating it on mainnet…"
            : "Reading current prices…"}
        </p>
      ) : null}
      {state.step === "review" || state.step === "expired" ? (
        <ReviewPanel
          quote={state.quote}
          expired={state.step === "expired"}
          onConfirm={() => void flow.sign()}
          onRequote={requestQuote}
          onCancel={flow.cancel}
          busy={false}
        />
      ) : null}
      <TradeStatus state={state} onReset={flow.cancel} />
      {wallet.error && channel === "live" ? (
        <p role="alert" className="mt-3 text-small text-down">
          {wallet.error}
        </p>
      ) : null}
    </section>
  );
}

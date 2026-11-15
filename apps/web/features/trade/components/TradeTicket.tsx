import { Badge, Button, NetworkBadge, Section } from "@ovelo/ui";
import { ShieldCheck } from "lucide-react";
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
import {
  FinePrint,
  PillRadioGroup,
  TicketSide,
  amountInputClass,
  selectClass,
} from "./TicketParts";
import { TradeStatus } from "./TradeStatus";

const CHANNELS = [
  ["live", "Mainnet spot purchase"],
  ["paper", "Paper practice"],
] as const;

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
  const live = channel === "live";
  const symbol = live
    ? (FUNDING_TOKENS.find((t) => t.mint === funding)?.symbol ?? "")
    : "USD";

  // M9 compliance gate (additive): a gate refusal re-reads the status so the ticket shows why.
  useComplianceRefresh(state.step === "error" ? state.error.code : null);

  const requestQuote = () =>
    void flow.quote({ channel, amount: amount.trim(), inputMint: funding });

  return (
    <Section
      id="trade"
      eyebrow="Trade"
      title={title}
      description={
        live
          ? "Buy from your own wallet on Solana mainnet. You review and sign every transaction."
          : "Practice at observed prices. No transaction is created and no real funds move."
      }
      actions={
        <>
          <NetworkBadge kind={live ? "mainnet-spot" : "paper"} />
          {live ? <ConnectButton /> : null}
        </>
      }
    >
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
        <fieldset className="flex flex-col gap-4" disabled={!editing}>
          <legend className="sr-only">Order type</legend>
          <PillRadioGroup
            name={`${ids.heading}-channel`}
            label="Order type"
            value={channel}
            options={CHANNELS}
            onChange={setChannel}
          />
          <TicketSide>
            <div className="grid gap-3 sm:grid-cols-[1fr_9rem] sm:items-end">
              <div className="flex min-w-0 flex-col gap-2">
                <label
                  htmlFor={ids.amount}
                  className="text-caption font-medium text-muted"
                >
                  Amount ({symbol})
                </label>
                <input
                  id={ids.amount}
                  data-ticket-amount=""
                  inputMode="decimal"
                  autoComplete="off"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className={amountInputClass}
                  placeholder="0.00"
                />
              </div>
              {live ? (
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor={ids.funding}
                    className="text-caption font-medium text-muted"
                  >
                    Pay with
                  </label>
                  <select
                    id={ids.funding}
                    value={funding}
                    onChange={(e) => setFunding(e.target.value)}
                    className={selectClass}
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
          </TicketSide>
        </fieldset>
        {editing ? (
          // M9 compliance gate (additive): location, then terms, before a mainnet quote.
          <TradeComplianceGate live={live} signer={wallet.signer}>
            <div className="flex flex-col gap-3">
              <Button
                variant="solid"
                size="lg"
                fullWidth
                onClick={requestQuote}
                disabled={
                  !amount.trim() || (live && wallet.status !== "connected")
                }
              >
                Get quote
              </Button>
              {live && wallet.status !== "connected" ? (
                <FinePrint>
                  Connect a mainnet wallet to get a signable quote.
                </FinePrint>
              ) : null}
              {!live ? (
                <Badge tone="neutral" className="w-fit">
                  Practice: no transaction is created
                </Badge>
              ) : null}
            </div>
          </TradeComplianceGate>
        ) : null}
        {state.step === "quoting" ? (
          <p role="status" className="text-small text-muted">
            {live
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
        {wallet.error && live ? (
          <p
            role="alert"
            className="rounded-tile bg-down-soft px-4 py-3 text-small text-down"
          >
            {wallet.error}
          </p>
        ) : null}
        <p className="inline-flex items-center gap-2 border-t border-line pt-5 text-caption text-muted">
          <ShieldCheck aria-hidden="true" className="size-4 shrink-0" />
          {live
            ? "You sign in your own wallet. Ovelo never holds your keys or funds."
            : "Paper practice uses virtual funds only."}
        </p>
      </div>
    </Section>
  );
}

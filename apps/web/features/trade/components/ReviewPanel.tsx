import { Badge, Button } from "@aroma/ui";
import { formatUnits } from "@aroma/ui/format";
import { Fragment, useEffect, useState } from "react";
import { quoteClock, type AnyQuote } from "../flow";
import { usd } from "../../caps/config";
// --- M9 compliance gate (additive) ---
import { RiskDisclosure } from "../../compliance/components/RiskDisclosure";
import type { DisclosureSurface } from "../../compliance/disclosures";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Which disclosure a live quote needs: stock, curated basket or creator basket (UUID id). */
function disclosureSurface(quote: AnyQuote): DisclosureSurface {
  if (quote.channel !== "live" || quote.quote.kind === "spot") return "spot";
  return UUID.test(quote.quote.basketId ?? "") ? "creator-basket" : "basket";
}
// --- end M9 compliance gate ---

/**
 * The review screen (PRODUCT.md): what is bought, the source and route, price impact, fees,
 * minimum received and how old the quote is. Every figure comes from the quote response; a
 * figure the quote does not carry is shown as "not reported", never estimated.
 */
/** Exact (fractionDigits = decimals): a minimum received is never rounded up. */
const units = (raw: string, decimals: number) =>
  formatUnits(BigInt(raw), decimals, { fractionDigits: decimals }).text;
const sol = (lamports: string) => units(lamports, 9);

function Row({
  label,
  value,
  first = false,
}: {
  label: string;
  value: string;
  /** Starts a leg: a divider above (dl > div > dt|dd stays valid, axe definition-list). */
  first?: boolean;
}) {
  return (
    <div
      className={`flex justify-between gap-4 py-1${first ? " mt-1 border-t border-line pt-2" : ""}`}
    >
      <dt className="text-muted">{label}</dt>
      <dd className="text-right tabular-nums">{value}</dd>
    </div>
  );
}

export function ReviewPanel({
  quote,
  expired,
  onConfirm,
  onRequote,
  onCancel,
  busy,
}: {
  quote: AnyQuote;
  expired: boolean;
  onConfirm: () => void;
  onRequote: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  const { ageSeconds, remainingSeconds } = quoteClock(quote, now);
  const live = quote.channel === "live";

  return (
    <section
      aria-labelledby="review-title"
      className="mt-4 rounded-panel border border-line p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="review-title" className="text-body font-semibold">
          Review {live ? "mainnet spot purchase" : "paper practice order"}
        </h3>
        <Badge tone={live ? "accent" : "neutral"}>
          {live ? "Mainnet" : "Paper"}
        </Badge>
      </div>
      <dl className="mt-3 text-small">
        {live ? (
          <>
            <Row
              label="Source"
              value={`${quote.quote.source} route, simulated on mainnet`}
            />
            <Row
              label="You pay (max)"
              value={`${units(quote.quote.maxDebit, quote.quote.inputDecimals)} ${quote.quote.inputSymbol || "funding token"}`}
            />
            {quote.quote.legs.map((leg) => (
              // M9 a11y fix: the leg's rows are direct children of the <dl> (no nested div).
              <Fragment key={leg.mint}>
                <Row
                  first
                  label={`${leg.symbol} expected`}
                  value={units(leg.outAmount, leg.decimals)}
                />
                <Row
                  label={`${leg.symbol} minimum received`}
                  value={units(leg.minimumAmount, leg.decimals)}
                />
                <Row
                  label="Route"
                  value={
                    leg.hops === null
                      ? "not reported"
                      : `${leg.hops} hop${leg.hops === 1 ? "" : "s"}`
                  }
                />
                <Row
                  label="Price impact"
                  value={
                    leg.priceImpactPct === null
                      ? "not reported"
                      : `${(Number(leg.priceImpactPct) * 100).toFixed(3)}%`
                  }
                />
              </Fragment>
            ))}
            <Row
              label="Slippage limit"
              value={`${quote.quote.slippageBps / 100}%`}
            />
            <Row
              label="Network fee"
              value={`${sol(quote.quote.fees.baseFeeLamports)} SOL`}
            />
            <Row
              label="Priority fee"
              value={
                quote.quote.fees.priorityFeeLamports === null
                  ? "not reported"
                  : `${sol(quote.quote.fees.priorityFeeLamports)} SOL`
              }
            />
            {quote.quote.fees.tipLamports !== "0" ? (
              <Row
                label="Bundle tip (Jito)"
                value={`${sol(quote.quote.fees.tipLamports)} SOL`}
              />
            ) : null}
            <Row label="Aroma fee" value="None" />
            <Row
              label="Transactions to sign"
              value={String(quote.transactions.length)}
            />
            {/* Phase A caps (W3): the server's own figures for this wallet. */}
            {quote.limits ? (
              <Row
                label="Beta limits"
                value={`max ${usd(BigInt(quote.limits.perTradeRaw))} per trade, ${usd(BigInt(quote.limits.remainingTodayRaw))} left today (UTC, before this trade)`}
              />
            ) : null}
          </>
        ) : (
          <>
            <Row label="Source" value="Jupiter Price V3 (observed prices)" />
            <Row label="Practice amount" value={`$${quote.amountUsd}`} />
            {quote.legs.map((leg) => (
              <Row
                key={leg.symbol}
                label={`${leg.symbol} at $${leg.priceUsd}`}
                value={leg.quantity}
              />
            ))}
            <Row
              label="Prices observed"
              value={quote.pricesObservedAt ?? "not reported"}
            />
          </>
        )}
        <Row label="Quote age" value={`${ageSeconds}s`} />
        <Row
          label="Expires in"
          value={expired ? "expired" : `${remainingSeconds}s`}
        />
      </dl>
      {live && quote.quote.atomicityWarning ? (
        <p
          role="note"
          className="mt-2 rounded-control bg-warning-soft p-2 text-small text-warning"
        >
          {quote.quote.atomicityWarning}
        </p>
      ) : null}
      {/* M9 compliance gate (additive): live confirm controls exist only inside the disclosure. */}
      {live ? (
        <RiskDisclosure surface={disclosureSurface(quote)}>
          <ReviewActions
            live
            expired={expired}
            busy={busy}
            onConfirm={onConfirm}
            onRequote={onRequote}
            onCancel={onCancel}
          />
        </RiskDisclosure>
      ) : (
        <div className="mt-4">
          <ReviewActions
            live={false}
            expired={expired}
            busy={busy}
            onConfirm={onConfirm}
            onRequote={onRequote}
            onCancel={onCancel}
          />
        </div>
      )}
    </section>
  );
}

function ReviewActions({
  live,
  expired,
  busy,
  onConfirm,
  onRequote,
  onCancel,
}: {
  live: boolean;
  expired: boolean;
  busy: boolean;
  onConfirm: () => void;
  onRequote: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {expired ? (
        <Button onClick={onRequote}>Quote expired: get a new quote</Button>
      ) : (
        <Button onClick={onConfirm} loading={busy}>
          {live ? "Sign and buy on mainnet" : "Place paper order"}
        </Button>
      )}
      <Button variant="secondary" onClick={onCancel} disabled={busy}>
        Cancel
      </Button>
    </div>
  );
}

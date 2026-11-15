import { Badge, type BadgeTone } from "@ovelo/ui";
import { formatChainTime, formatRaw } from "../server/format";
import { explorerUrl, oraclePriceText } from "../amounts";
import type { TimelineEntryView } from "../schema";

/**
 * One row per period, from the chain and receipts (B7). Skipped periods are always shown, with
 * whether the program has recorded them yet; nothing is estimated.
 */

const OUTPUT_DECIMALS = 8;

const LABEL: Record<
  TimelineEntryView["status"],
  { text: string; tone: BadgeTone }
> = {
  executed: { text: "Executed", tone: "up" },
  skipped: { text: "Skipped", tone: "down" },
  pending: { text: "Pending", tone: "neutral" },
  due: { text: "Due", tone: "accent" },
  in_progress: { text: "In progress", tone: "warning" },
  unindexed: { text: "Settled", tone: "neutral" },
};

function detail(entry: TimelineEntryView): string {
  const at = formatChainTime(BigInt(entry.scheduledAt));
  switch (entry.status) {
    case "skipped":
      return entry.recordedOnChain
        ? "Skipped: missed the catch-up window. Recorded on-chain."
        : "Skipped: missed the catch-up window. It will be recorded on-chain at the plan's next execution.";
    case "pending":
      return `Opens ${at}.`;
    case "due":
      return `Due since ${at}; runs when the keeper next executes with a fresh Pyth price.`;
    case "in_progress":
      return "Some legs ran; the rest run in the next transactions.";
    case "unindexed":
      return "Settled on-chain; details are being indexed.";
    case "executed":
      return `Period opened ${at}.`;
  }
}

export function PlanTimeline({
  entries,
  fundingSymbol,
  fundingDecimals,
  cluster,
  explorerRpcUrl,
}: {
  entries: TimelineEntryView[];
  fundingSymbol: string;
  fundingDecimals: number;
  cluster: "devnet" | "localnet";
  explorerRpcUrl: string;
}) {
  return (
    <ol className="flex flex-col gap-2" aria-label="Installments by period">
      {entries.map((entry) => {
        const label = LABEL[entry.status];
        return (
          <li
            key={entry.period}
            data-testid="timeline-row"
            data-status={entry.status}
            data-period={entry.period}
            className="flex flex-col gap-1 rounded-control border border-line p-3 text-small"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">Period {entry.period + 1}</span>
              <Badge tone={label.tone}>{label.text}</Badge>
            </div>
            <p className="text-muted">{detail(entry)}</p>
            {entry.executions.map((execution) => (
              <div
                key={execution.signature}
                className="flex flex-col gap-1 border-t border-line pt-2"
              >
                <a
                  className="text-accent underline focus-ring"
                  href={explorerUrl(
                    execution.signature,
                    cluster,
                    explorerRpcUrl,
                  )}
                  target="_blank"
                  rel="noreferrer"
                >
                  Transaction {execution.signature.slice(0, 8)}…
                </a>
                {execution.blockTime ? (
                  <span className="text-caption text-muted">
                    Confirmed {formatChainTime(BigInt(execution.blockTime))}
                  </span>
                ) : null}
                <ul className="flex flex-col gap-0.5">
                  {execution.legs.map((leg) => (
                    <li
                      key={`${execution.signature}-${leg.leg}`}
                      className="tabular-nums"
                    >
                      {leg.symbol ?? leg.mint.slice(0, 6)}:{" "}
                      {formatRaw(BigInt(leg.amountIn), fundingDecimals)}{" "}
                      {fundingSymbol} →{" "}
                      {formatRaw(BigInt(leg.amountOut), OUTPUT_DECIMALS)} tokens
                      at Pyth $
                      {oraclePriceText(leg.oraclePrice, leg.oracleExpo)}{" "}
                      (published{" "}
                      {formatChainTime(BigInt(leg.oraclePublishTime))})
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </li>
        );
      })}
    </ol>
  );
}

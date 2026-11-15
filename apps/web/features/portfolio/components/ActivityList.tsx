import { Badge } from "@ovelo/ui";
import { formatUnits } from "@ovelo/ui/format";
import { FUNDING_TOKENS } from "../../trade/schema";
import type { ActivityItem } from "../schema";

/** Orders this wallet placed through Ovelo, from our receipts (one row per transaction). */
export function ActivityList({
  activity,
}: {
  activity: readonly ActivityItem[] | null;
}) {
  if (activity === null)
    return (
      <p className="text-small text-muted">
        Order history is unavailable right now. This does not mean there were no
        orders.
      </p>
    );
  if (!activity.length)
    return (
      <p className="text-small text-muted">
        No orders placed through Ovelo yet.
      </p>
    );
  return (
    <ul className="grid gap-2">
      {activity.map((item) => {
        const token = FUNDING_TOKENS.find((t) => t.mint === item.mintIn);
        const tone =
          item.status === "confirmed"
            ? "up"
            : item.status === "failed"
              ? "down"
              : "warning";
        return (
          <li
            key={item.signature}
            className="rounded-panel border border-line p-3 text-small"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">
                {item.kind === "basket"
                  ? `Basket ${item.basket ?? ""}`.trim()
                  : "Stock purchase"}
              </span>
              <Badge tone={tone}>{item.status}</Badge>
            </div>
            <p className="mt-1 tabular-nums">
              Paid{" "}
              {token
                ? `${formatUnits(BigInt(item.amountIn), token.decimals, { fractionDigits: token.decimals }).text} ${token.symbol}`
                : `${item.amountIn} raw units`}{" "}
              for {item.legs.length} asset{item.legs.length === 1 ? "" : "s"}
            </p>
            <p className="text-caption text-muted">
              {item.blockTime
                ? `Confirmed ${new Date(item.blockTime).toISOString().replace("T", " ").slice(0, 16)} UTC`
                : `Submitted ${item.createdAt.replace("T", " ").slice(0, 16)} UTC`}{" "}
              ·{" "}
              <a
                className="underline focus-ring"
                href={`https://solscan.io/tx/${item.signature}`}
                target="_blank"
                rel="noreferrer"
              >
                View on Solscan
              </a>
            </p>
          </li>
        );
      })}
    </ul>
  );
}

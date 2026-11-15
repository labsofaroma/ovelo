import { ArrowDownLeft, ExternalLink, Layers } from "lucide-react";
import { Badge, EmptyState } from "@ovelo/ui";
import { formatUnits } from "@ovelo/ui/format";
import { FUNDING_TOKENS } from "../../trade/schema";
import { portfolioCopy } from "../copy";
import type { ActivityItem } from "../schema";

const a = portfolioCopy.activity;

/** Orders this wallet placed through Ovelo, from our receipts (one row per transaction). */
export function ActivityList({
  activity,
}: {
  activity: readonly ActivityItem[] | null;
}) {
  if (activity === null) return <EmptyState title={a.unavailable} />;
  if (!activity.length) return <EmptyState title={a.empty} />;
  return (
    <ul className="flex flex-col divide-y divide-line">
      {activity.map((item) => {
        const token = FUNDING_TOKENS.find((t) => t.mint === item.mintIn);
        const tone =
          item.status === "confirmed"
            ? "up"
            : item.status === "failed"
              ? "down"
              : "warning";
        const Icon = item.kind === "basket" ? Layers : ArrowDownLeft;
        return (
          <li
            key={item.signature}
            className="flex min-h-16 flex-wrap items-center gap-x-4 gap-y-2 px-2 py-3"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-full border border-line bg-raised-2 text-muted">
              <Icon className="size-4" aria-hidden />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-small font-medium text-ink">
                {item.kind === "basket"
                  ? `Basket ${item.basket ?? ""}`.trim()
                  : a.stock}
              </span>
              <span className="text-caption text-muted tabular-nums">
                Paid{" "}
                {token
                  ? `${formatUnits(BigInt(item.amountIn), token.decimals, { fractionDigits: token.decimals }).text} ${token.symbol}`
                  : `${item.amountIn} raw units`}{" "}
                for {item.legs.length} asset
                {item.legs.length === 1 ? "" : "s"}
              </span>
              <span className="text-caption text-muted tabular-nums">
                {item.blockTime
                  ? `Confirmed ${new Date(item.blockTime).toISOString().replace("T", " ").slice(0, 16)} UTC`
                  : `Submitted ${item.createdAt.replace("T", " ").slice(0, 16)} UTC`}
              </span>
            </span>
            <span className="flex items-center gap-3">
              <Badge tone={tone}>{item.status}</Badge>
              <a
                className="inline-flex items-center gap-1 rounded-badge text-caption text-muted underline-offset-2 hover:text-ink hover:underline focus-ring"
                href={`https://solscan.io/tx/${item.signature}`}
                target="_blank"
                rel="noreferrer"
              >
                {a.solscan}
                <ExternalLink className="size-3" aria-hidden />
              </a>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

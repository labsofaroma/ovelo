import Link from "next/link";
import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { Callout } from "@ovelo/ui";

/**
 * Explicit partial or unavailable market-data state as an inline callout (redesign MarketStatus).
 * Unavailable is announced as an alert; partial is a status. Never replaced by placeholder numbers.
 */
export function MarketNotice({
  title,
  items = [],
  children,
  tone = "warning",
  refreshHref,
}: {
  title: string;
  /** Provider warnings, already client-safe (fixed strings from lib/sdk, never error text). */
  items?: readonly string[];
  children?: ReactNode;
  tone?: "warning" | "unavailable";
  /** Reloads the page (a plain link, so it works without JavaScript). */
  refreshHref?: string;
}) {
  return (
    <Callout
      tone={tone === "unavailable" ? "danger" : "warning"}
      role={tone === "unavailable" ? "alert" : "status"}
      data-state={tone}
      title={title}
    >
      <div className="flex flex-col gap-2">
        {children}
        {items.length ? (
          <ul className="list-disc space-y-1 pl-5 text-caption">
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}
        {refreshHref ? (
          <Link
            href={refreshHref}
            prefetch={false}
            className="mt-1 inline-flex min-h-9 w-fit items-center gap-2 rounded-full border border-border-strong px-4 text-small font-medium text-ink transition-colors motion-base hover:bg-raised-2 focus-ring"
          >
            <RefreshCw aria-hidden="true" className="size-3.5" />
            Refresh
          </Link>
        ) : null}
      </div>
    </Callout>
  );
}

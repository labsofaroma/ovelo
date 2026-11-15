import { cn } from "@ovelo/ui";
import { classifyFreshness, formatObservedAt } from "../freshness";
import { StaleBadge } from "./StaleBadge";

export interface AsOfProps {
  /** ISO timestamp of the observation; null renders the honest "not observed" state. */
  observedAt: string | null | undefined;
  /** Human source name, e.g. "Jupiter Tokens V2". */
  source?: string | null;
  sourceUrl?: string | null;
  staleAfterMs: number;
  /** Prefix, default "As of". */
  label?: string;
  className?: string;
}

/**
 * Source + timestamp line required next to every figure (PRODUCT.md). Server-rendered; only the
 * stale badge is a client island, so the timestamp and source are in the HTML.
 */
export function AsOf({
  observedAt,
  source,
  sourceUrl,
  staleAfterMs,
  label = "As of",
  className,
}: AsOfProps) {
  const at = observedAt ?? null;
  const text = at ? formatObservedAt(at) : null;
  const initial = classifyFreshness(at, staleAfterMs);
  return (
    <p
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted",
        className,
      )}
    >
      <span>
        {text && at ? (
          <>
            {label} <time dateTime={at}>{text}</time>
          </>
        ) : (
          "Observation time unavailable"
        )}
      </span>
      {source ? (
        <span>
          · Source:{" "}
          {sourceUrl ? (
            <a
              className="text-ink underline underline-offset-2"
              href={sourceUrl}
              rel="noreferrer"
              target="_blank"
            >
              {source}
            </a>
          ) : (
            source
          )}
        </span>
      ) : null}
      <StaleBadge
        observedAt={at}
        staleAfterMs={staleAfterMs}
        initial={initial}
      />
    </p>
  );
}

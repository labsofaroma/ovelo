import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";

export interface DataNoticeProps {
  title: string;
  /** Provider warnings, already client-safe (fixed strings from lib/sdk, never error text). */
  items?: readonly string[];
  children?: ReactNode;
  tone?: "warning" | "unavailable";
}

/** Explicit partial/unavailable state. Never replaced by placeholder numbers. */
export function DataNotice({
  title,
  items = [],
  children,
  tone = "warning",
}: DataNoticeProps) {
  return (
    <section
      role={tone === "unavailable" ? "alert" : "status"}
      data-state={tone}
      className="flex items-start gap-3 rounded-tile border border-transparent bg-warning-soft p-4 text-small text-ink md:p-5"
    >
      <AlertTriangle
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-warning"
      />
      <div className="flex min-w-0 flex-col gap-1.5">
        <h2 className="text-small font-semibold text-ink">{title}</h2>
        {children ? (
          <div className="leading-body text-muted [&_a]:text-ink [&_a]:underline [&_a]:underline-offset-4">
            {children}
          </div>
        ) : null}
        {items.length ? (
          <ul className="list-disc space-y-1 pl-5 text-caption text-muted">
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

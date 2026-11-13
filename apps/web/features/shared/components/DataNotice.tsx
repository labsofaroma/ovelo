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
      className="rounded-panel border border-line bg-warning-soft p-4 text-small text-ink"
    >
      <h2 className="flex items-center gap-2 text-small font-semibold">
        <AlertTriangle aria-hidden="true" className="size-4 text-warning" />
        {title}
      </h2>
      {children ? <div className="mt-2">{children}</div> : null}
      {items.length ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-caption">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

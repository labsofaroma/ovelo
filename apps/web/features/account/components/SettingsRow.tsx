import type { ReactNode } from "react";

/**
 * A labelled line inside a settings card with its control on the right (below on phones). The
 * redesign's settings row; server-safe, so pages and client islands can both use it.
 */
export function SettingsRow({
  title,
  body,
  children,
}: {
  title: ReactNode;
  body?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-line py-5 first:border-t-0 first:pt-0 last:pb-0 md:flex-row md:items-center md:justify-between md:gap-8">
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="text-small font-semibold text-ink">{title}</h3>
        {body ? <div className="text-small text-muted">{body}</div> : null}
      </div>
      {children ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {children}
        </div>
      ) : null}
    </div>
  );
}

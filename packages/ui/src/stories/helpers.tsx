import { useEffect, useRef, type ReactNode } from "react";

/**
 * Renders children on the app background. Ovelo is dark only, so this is a single panel; the
 * name and render-prop shape are kept so existing "Themes" stories need no change.
 */
export function Themes({
  children,
}: {
  children: ReactNode | ((theme: "dark") => ReactNode);
}) {
  return (
    <div className="grid gap-4">
      {(["dark"] as const).map((theme) => (
        <section
          key={theme}
          data-theme={theme}
          aria-label={`${theme} theme`}
          className="flex flex-col gap-4 rounded-panel border border-line bg-bg p-6 text-ink"
        >
          <p className="text-micro font-semibold uppercase tracking-[0.15em] text-muted">
            {theme}
          </p>
          {typeof children === "function" ? children(theme) : children}
        </section>
      ))}
    </div>
  );
}

/** Labelled row used to lay out the states of one component. */
export function Row({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-caption font-semibold text-muted">{label}</p>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

/** Every story value is a sample. Keep this label near any figure so it never reads as real data. */
export const DEMO = "Demo value";

/** Moves keyboard focus to the first focusable child on mount, so "Focus" stories show the real ring. */
export function AutoFocus({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current
      ?.querySelector<HTMLElement>(
        "a[href], button, input, [tabindex]:not([tabindex='-1'])",
      )
      ?.focus();
  }, []);
  return <div ref={ref}>{children}</div>;
}

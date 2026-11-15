import { Badge } from "@ovelo/ui";
import { useId, type ReactNode } from "react";
import {
  DISCLOSURE_IS_PLACEHOLDER,
  DISCLOSURE_VERSION,
  disclosureLines,
  type DisclosureSurface,
} from "../disclosures";

/**
 * The risk disclosure on every trade review (M9 compliance gate, C4). It cannot be skipped or
 * hidden: the review's confirm controls are its CHILDREN, so they only exist while the
 * disclosure is rendered in full (no collapse, no dismiss, no "don't show again").
 *
 * Copy: placeholder pending counsel's final text (features/compliance/disclosures.ts).
 */
export function RiskDisclosure({
  surface,
  children,
}: {
  surface: DisclosureSurface;
  /** The confirm and cancel controls of the review. */
  children: ReactNode;
}) {
  const heading = useId();
  return (
    <section
      aria-labelledby={heading}
      data-disclosure-version={DISCLOSURE_VERSION}
      data-disclosure-surface={surface}
      className="mt-4 rounded-control border border-line bg-raised p-3 text-small"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={heading} className="font-semibold">
          Risk disclosure
        </h4>
        {DISCLOSURE_IS_PLACEHOLDER ? (
          <Badge tone="neutral">Placeholder text: pending counsel</Badge>
        ) : null}
      </div>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
        {disclosureLines(surface).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <div className="mt-3">{children}</div>
    </section>
  );
}

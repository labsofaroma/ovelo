import Link from "next/link";
import { Section } from "@ovelo/ui";
import { routes } from "../../shared/routes";
import { investCopy } from "../copy";

const copy = investCopy.mainnet;

/** Pill link styled like the @ovelo/ui `primary` button (its class helper is client-only). */
const pillLink =
  "inline-flex min-h-(--ovelo-control-height-compact) w-fit items-center justify-center gap-2 rounded-full border border-(--ovelo-pill-border) bg-pill px-4 text-caption font-medium text-ink transition-[filter,border-color] motion-base hover:brightness-125 hover:border-border-strong focus-ring";

/**
 * M10 / Phase C, Path B: mainnet recurring is not offered. A static, non-interactive notice
 * with the real reason (docs/launch/DCA-SPIKE.md) and no date promise.
 */
export function MainnetRecurringComing() {
  return (
    <Section
      data-testid="mainnet-recurring-coming"
      eyebrow="Mainnet"
      title={copy.heading}
    >
      <div className="flex flex-col gap-4">
        <p role="status" className="text-body leading-body text-ink">
          {copy.status}
        </p>
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {copy.reasons.map((reason) => (
            <li
              key={reason}
              className="rounded-tile border border-line bg-raised p-4 text-small leading-body text-muted"
            >
              {reason}
            </li>
          ))}
        </ul>
        <p className="max-w-[70ch] text-small leading-body text-muted">
          {copy.plan}
        </p>
        <div className="flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-small text-ink">{copy.meanwhile}</p>
          <Link href={routes.markets} className={pillLink}>
            {copy.marketsLink}
          </Link>
        </div>
      </div>
    </Section>
  );
}

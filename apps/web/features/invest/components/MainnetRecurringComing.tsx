import Link from "next/link";
import { routes } from "../../shared/routes";
import { investCopy } from "../copy";

const copy = investCopy.mainnet;

/**
 * M10 / Phase C, Path B: mainnet recurring is not offered. A static, non-interactive notice
 * with the real reason (docs/launch/DCA-SPIKE.md) and no date promise.
 */
export function MainnetRecurringComing() {
  return (
    <section
      aria-labelledby="mainnet-recurring-heading"
      data-testid="mainnet-recurring-coming"
      className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4"
    >
      <h2 id="mainnet-recurring-heading" className="text-section font-semibold">
        {copy.heading}
      </h2>
      <p role="status" className="text-small">
        {copy.status}
      </p>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-small text-muted">
        {copy.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
      <p className="text-small text-muted">{copy.plan}</p>
      <p className="text-small">
        {copy.meanwhile}{" "}
        <Link href={routes.markets} className="underline underline-offset-2">
          {copy.marketsLink}
        </Link>
      </p>
    </section>
  );
}

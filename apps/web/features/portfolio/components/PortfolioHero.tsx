import type { ReactNode } from "react";
import { NetworkBadge, Section } from "@ovelo/ui";
import { portfolioCopy as copy } from "../copy";

/**
 * Card 1 of /portfolio: the page's h1, the network it reads (always mainnet spot), a status line
 * (usually the balances' source and time) and the headline figures as children.
 */
export function PortfolioHero({
  connected,
  status,
  actions,
  children,
}: {
  connected: boolean;
  status?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Section
      variant="hero"
      headingLevel="h1"
      eyebrow={copy.eyebrow}
      title={connected ? copy.title : copy.connectTitle}
      description={connected ? copy.description : copy.connectBody}
      actions={actions}
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <NetworkBadge kind="mainnet-spot" />
          {status}
        </div>
        {children}
      </div>
    </Section>
  );
}

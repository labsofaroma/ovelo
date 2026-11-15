import { Callout, Section } from "@ovelo/ui";

/**
 * Shown instead of the trade ticket when an asset or basket cannot be bought right now (issuer
 * pause, unverified listing, incomplete basket). A visible reason, and deliberately no quote,
 * amount or fee (nothing that could be mistaken for an executable price).
 */
export function TradeUnavailable({
  name,
  reason,
}: {
  name: string;
  reason: string;
}) {
  return (
    <Section id="trade" eyebrow="Trade" title={`Buy ${name}`}>
      <Callout tone="warning" title="Buying is off for now">
        {reason}
      </Callout>
    </Section>
  );
}

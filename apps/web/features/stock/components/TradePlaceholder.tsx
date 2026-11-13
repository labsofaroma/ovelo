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
    <section
      aria-labelledby="trade-heading"
      className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-4"
    >
      <h2 id="trade-heading" className="text-small font-semibold">
        Buy {name}
      </h2>
      <p className="text-caption text-muted">{reason}</p>
    </section>
  );
}

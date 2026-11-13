/**
 * M3 is read-only: the trade ticket arrives in M4. A disabled control with a visible reason, and
 * deliberately no quote, amount or fee (nothing that could be mistaken for an executable price).
 */
export function TradePlaceholder({ symbol }: { symbol: string }) {
  return (
    <section
      aria-labelledby="trade-heading"
      className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-4"
    >
      <h2 id="trade-heading" className="text-small font-semibold">
        Trade {symbol}
      </h2>
      <p id="trade-status" className="text-caption text-muted">
        Coming soon. Wallet trading is not available in this preview, so no
        quote is shown.
      </p>
      <button
        type="button"
        disabled
        aria-describedby="trade-status"
        className="min-h-(--aroma-control-height) cursor-not-allowed rounded-control border border-border-strong px-4 text-small font-semibold text-muted opacity-70"
      >
        Trade (coming soon)
      </button>
    </section>
  );
}

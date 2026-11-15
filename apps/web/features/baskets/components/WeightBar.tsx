import { cn } from "@ovelo/ui";

/**
 * The published weights as one segmented bar. Decorative (aria-hidden): the weights are always
 * also given as text next to it. Segment widths are the integer basis points, never rescaled.
 */
export function WeightBar({
  weights,
  className,
}: {
  weights: readonly { key: string; weightBps: number }[];
  className?: string;
}) {
  if (!weights.length) return null;
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full bg-raised-2",
        className,
      )}
    >
      {weights.map((leg, index) => (
        <span
          key={leg.key}
          className={index % 2 ? "bg-border-strong" : "bg-accent"}
          style={{
            flexGrow: Math.max(1, leg.weightBps),
            flexBasis: 0,
            opacity: 1 - (index % 5) * 0.15,
          }}
        />
      ))}
    </div>
  );
}

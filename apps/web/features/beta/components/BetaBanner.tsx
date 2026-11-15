import { pageContainer } from "../../shared/styles";
import { betaConfig } from "../config";

/**
 * The persistent "private beta" label on every v1 page while the gate is on (REWRITE-PLAN §7.3
 * W2; PRODUCT.md: label clearly what something is). Server-rendered from the deployment's own
 * configuration; renders nothing once Phase B switches the gate off.
 */
export function BetaBanner({
  env = process.env,
}: {
  env?: Record<string, string | undefined>;
}) {
  if (!betaConfig(env).gate) return null;
  return (
    // A landmark (complementary), so the banner is never content outside every region (axe).
    <aside
      aria-label="Private beta"
      data-beta-banner
      className={`${pageContainer} pt-4 md:pt-5`}
    >
      <p className="flex items-start gap-3 rounded-tile border border-transparent bg-warning-soft px-4 py-2.5 text-small text-ink md:items-center">
        <span
          aria-hidden="true"
          className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warning md:mt-0"
        />
        <span>
          <strong className="font-semibold">Private beta.</strong> Mainnet
          buying is open to invited wallets only, with small per-trade and daily
          limits. Everything else is open to browse. Expect changes.
        </span>
      </p>
    </aside>
  );
}

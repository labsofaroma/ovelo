/**
 * Risk disclosure copy shown on every trade review (M9 compliance gate, C4).
 *
 * NEEDS COUNSEL'S FINAL TEXT. Every string here is PLACEHOLDER copy written to make the mechanism
 * testable; it restates risks the product already describes elsewhere (terms page, PRODUCT.md)
 * and is NOT final legal wording. `DISCLOSURE_VERSION` changes when counsel's text lands.
 */
export const DISCLOSURE_VERSION = "placeholder-1";
export const DISCLOSURE_IS_PLACEHOLDER = true;

export type DisclosureSurface =
  "spot" | "basket" | "creator-basket" | "action" | "recurring-devnet";

const COMMON = [
  "Tokenized stocks are tokens issued by a third party. They are not the underlying shares and may not carry shareholder rights.",
  "Prices can fall as well as rise, and you can lose the full amount you commit. Liquidity can be thin or unavailable.",
  "Mainnet transactions are generally irreversible. Network fees can apply even when a transaction fails.",
  "Ovelo does not give investment, tax or legal advice.",
] as const;

const EXTRA: Record<DisclosureSurface, readonly string[]> = {
  spot: [],
  basket: [
    "A basket buys each constituent separately in one or more transactions; weights can drift from the target after purchase.",
  ],
  "creator-basket": [
    "This basket was published by a creator, not by Ovelo. Its selection is not a recommendation by Ovelo.",
  ],
  action: [
    "You are buying through a Blink outside Ovelo's site; review the transaction in your wallet before you sign.",
  ],
  "recurring-devnet": [
    "This is a devnet test with test tokens of no value. Nothing here buys real assets.",
  ],
};

export function disclosureLines(surface: DisclosureSurface): readonly string[] {
  return surface === "recurring-devnet"
    ? EXTRA[surface]
    : [...COMMON, ...EXTRA[surface]];
}

/** One-paragraph form for the Solana Action metadata description (no markup there). */
export function disclosureSentence(
  ...surfaces: readonly DisclosureSurface[]
): string {
  const lines = [...new Set(surfaces.flatMap((s) => disclosureLines(s)))];
  return `Risk disclosure (placeholder, pending counsel's text): ${lines.join(" ")}`;
}

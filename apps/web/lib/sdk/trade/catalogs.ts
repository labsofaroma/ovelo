import type { MarketAsset, MarketSnapshot } from "../markets";

/** Orders only depend on the issuers of their selected assets. */
export function hasIssuerCatalogsForAssets(
  snapshot: Pick<MarketSnapshot, "sources" | "status">,
  assets: readonly Pick<MarketAsset, "issuer">[],
): boolean {
  if (snapshot.status === "unavailable") return false;
  return assets.every((asset) => {
    switch (asset.issuer) {
      case "xstocks":
        return snapshot.sources.includes("xStocks issuer catalog");
      case "prestocks":
        return snapshot.sources.includes("PreStocks issuer catalog");
      case "backpack":
        return [
          "Backpack securities catalog",
          "Backpack Solana mappings",
        ].every((source) => snapshot.sources.includes(source));
      default:
        return false;
    }
  });
}

/** Missing issuer catalogs must not turn existing holdings into an apparent zero balance. */
export function hasCompleteIssuerCatalogs(
  snapshot: Pick<MarketSnapshot, "sources" | "status" | "backpackSecurities">,
): boolean {
  return (
    snapshot.status !== "unavailable" &&
    ["xStocks issuer catalog", "PreStocks issuer catalog"].every((source) =>
      snapshot.sources.includes(source),
    ) &&
    // Older persisted snapshots did not include Backpack. New server snapshots
    // must not silently downgrade its known securities into arbitrary tokens.
    (snapshot.backpackSecurities === undefined ||
      ["Backpack securities catalog", "Backpack Solana mappings"].every(
        (source) => snapshot.sources.includes(source),
      ))
  );
}

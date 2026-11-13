import { expect, test } from "vitest";
import type { MarketSnapshot } from "../markets";

type CatalogView = Pick<MarketSnapshot, "status" | "sources">;
import {
  hasCompleteIssuerCatalogs,
  hasIssuerCatalogsForAssets,
} from "./catalogs";

test("missing issuer catalogs cannot be presented as a complete empty portfolio", () => {
  expect(
    hasCompleteIssuerCatalogs({
      status: "partial" as const,
      sources: ["PreStocks issuer catalog", "Jupiter Tokens V2"],
    }),
  ).toBe(false);
  expect(
    hasCompleteIssuerCatalogs({
      status: "partial" as const,
      sources: ["xStocks issuer catalog"],
    }),
  ).toBe(false);
  expect(
    hasCompleteIssuerCatalogs({ status: "unavailable" as const, sources: [] }),
  ).toBe(false);
  // Price outages can remain partial without losing the ability to identify every issuer holding.
  expect(
    hasCompleteIssuerCatalogs({
      status: "partial" as const,
      sources: ["xStocks issuer catalog", "PreStocks issuer catalog"],
    }),
  ).toBe(true);
});

test("order issuer requirements follow selected assets rather than the full market universe", () => {
  const snapshot: CatalogView = {
    status: "partial",
    sources: ["xStocks issuer catalog"],
  };
  expect(hasIssuerCatalogsForAssets(snapshot, [{ issuer: "xstocks" }])).toBe(
    true,
  );
  expect(hasIssuerCatalogsForAssets(snapshot, [{ issuer: "prestocks" }])).toBe(
    false,
  );
  expect(
    hasIssuerCatalogsForAssets(snapshot, [
      { issuer: "xstocks" },
      { issuer: "prestocks" },
    ]),
  ).toBe(false);
  expect(
    hasIssuerCatalogsForAssets({ ...snapshot, status: "unavailable" }, [
      { issuer: "xstocks" },
    ]),
  ).toBe(false);
  expect(hasIssuerCatalogsForAssets(snapshot, [{ issuer: "other" }])).toBe(
    false,
  );
  expect(
    hasIssuerCatalogsForAssets(
      { status: "partial" as const, sources: ["Backpack securities catalog"] },
      [{ issuer: "backpack" }],
    ),
  ).toBe(false);
  expect(
    hasIssuerCatalogsForAssets(
      {
        status: "partial" as const,
        sources: ["Backpack securities catalog", "Backpack Solana mappings"],
      },
      [{ issuer: "backpack" }],
    ),
  ).toBe(true);
});

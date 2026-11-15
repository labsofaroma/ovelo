import type { BasisStatus } from "./pnl/schema";

/**
 * Portfolio P&L wording (M11 Step 2). P&L is information about this wallet's own purchases, not
 * advice; every figure says where it comes from, and anything not known says so.
 */
export const pnlCopy = {
  heading: "Profit and loss",
  method:
    "Average cost of what this wallet bought through Ovelo (exact amounts from the confirmed transactions). 1 USDC is counted as 1 USD. Holdings from anywhere else have no cost basis here.",
  unavailable:
    "Profit and loss is unavailable right now: order history could not be read.",
  totalsLabel: "Unrealized, where cost and price are both known",
  leftOut: (n: number) =>
    n === 0
      ? "Every holding is included."
      : `${n} holding${n === 1 ? "" : "s"} left out (cost basis unknown or no price).`,
  noneKnown: "No holding has a known cost basis yet.",
  realized: "Realized P&L: not shown. Ovelo records purchases only, not sales.",
  columns: {
    asset: "Asset",
    quantity: "Quantity",
    cost: "Cost basis",
    value: "Value now",
    pnl: "Unrealized P&L",
  },
  basketsHeading: "Baskets bought through Ovelo",
  basketsNone: "No basket bought through Ovelo yet.",
  orders: (n: number) => `${n} order${n === 1 ? "" : "s"}`,
  status: {
    known: "Known",
    outside: "Cost basis unknown: some came from outside Ovelo",
    none: "Cost basis unknown: not bought through Ovelo",
    other_funding: "Cost basis unknown: bought with SOL or USDT",
    fill_pending: "Cost basis not read yet: refresh in a minute",
    funding: "Funding token: no P&L",
    unpriced: "No price now",
  } satisfies Record<BasisStatus | "unpriced", string>,
  priceAt: (source: string, at: string) => `Price: ${source}, ${at}`,
  export: "Download CSV",
  exportHint:
    "Your wallet signs a message so only you can download this wallet's history. The signature does not move funds.",
  exportFailed: "The CSV could not be prepared.",
} as const;

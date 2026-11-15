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

/** /portfolio page wording: section titles and states (redesign layout, v1 facts). */
export const portfolioCopy = {
  eyebrow: "Portfolio",
  title: "Your wallet",
  connectTitle: "See what your wallet holds",
  description:
    "Mainnet holdings of your connected wallet. Values use observed token prices only; unpriced holdings are listed without a value.",
  connectBody:
    "Connect a Solana mainnet wallet to see its holdings and the orders you placed through Ovelo. Ovelo reads public balances; it never holds your funds or keys.",
  reading: "Reading balances from Solana mainnet…",
  unavailableTitle: "Your portfolio is unavailable right now",
  warningsTitle: "Some data is missing",
  balancesSource: "Solana mainnet RPC",
  balancesLabel: "Balances read",
  pricesLabel: "Prices as of",
  summary: {
    priced: "Priced value",
    unpriced: (n: number) =>
      `${n} holding${n === 1 ? "" : "s"} without a price not included`,
    allPriced: "Every holding is priced",
    spent: "Spent through Ovelo (confirmed)",
    spentUnavailable: "Order history is unavailable right now.",
    spentNone: "None recorded",
    sol: "SOL balance",
    solDetail: "For token accounts and network fees",
    count: "Assets held",
    countDetail: "Priced and unpriced",
  },
  allocation: {
    title: "Allocation",
    description:
      "Share of the priced value by holding, from observed prices. A snapshot, not a forecast.",
    empty: "No priced holdings, so there is no allocation to show.",
    label: "Allocation of priced holdings",
    other: "Other",
    excluded: (n: number) =>
      `${n} unpriced holding${n === 1 ? "" : "s"} excluded`,
  },
  holdings: {
    title: "Holdings",
    description:
      "Balances read from the chain; a value only where a token price was observed.",
    empty: "No token balances in this wallet.",
    caption: "Token holdings",
    asset: "Asset",
    balance: "Balance",
    price: "Price",
    value: "Value",
    notCatalog: "Not in the issuer catalog",
    noPrice: "No token price",
    unpriced: "Unpriced",
  },
  activity: {
    title: "Activity",
    description:
      "Orders this wallet placed through Ovelo, from our receipts. One row per transaction.",
    unavailable:
      "Order history is unavailable right now. This does not mean there were no orders.",
    empty: "No orders placed through Ovelo yet.",
    stock: "Stock purchase",
    solscan: "View on Solscan",
  },
  wallet: {
    title: "Wallet",
    connected: "Connected wallet",
    body: "Ovelo reads this wallet's public balances. You keep custody; nothing moves without your signature.",
    explorer: "View on Solscan",
  },
} as const;

import type { Issuer, PriceSource } from "./schema";

export const ISSUER_LABEL: Record<Issuer, string> = {
  xstocks: "xStocks",
  prestocks: "PreStocks",
  backpack: "Backpack",
  other: "Other issuer",
};

export const PRICE_SOURCE_LABEL: Record<PriceSource, string> = {
  "jupiter-tokens-v2": "Jupiter Tokens V2",
  "jupiter-price-v3": "Jupiter Price V3",
  "prestocks-issuer": "PreStocks issuer",
};

export const PRICE_SOURCE_URL: Record<PriceSource, string | null> = {
  "jupiter-tokens-v2": "https://dev.jup.ag/docs/token-api/v2",
  "jupiter-price-v3": "https://dev.jup.ag/docs/price-api/v3",
  "prestocks-issuer": null,
};

export const REFERENCE_SOURCE_LABEL = {
  pyth: "Pyth Network",
  "jupiter-stock-data": "Jupiter stock data",
} as const;

export const KIND_LABEL = {
  all: "All types",
  equity: "Stocks",
  etf: "ETFs",
  "pre-ipo": "Pre-IPO",
  unknown: "Unclassified",
} as const;

export const SORT_LABEL = {
  volume: "24h volume",
  change: "24h change",
  price: "Token price",
  marketCap: "Market cap",
  name: "Symbol (A–Z)",
} as const;

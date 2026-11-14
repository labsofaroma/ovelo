/** Pyth feed registry for xStocks and basket underlying equities. */

// ---------------------------------------------------------------------------
// Pyth Feed ID Registry for xStocks & Equity Reference
// ---------------------------------------------------------------------------

export interface StockFeedDefinition {
  symbol: string;
  name: string;
  xStockFeedId: string;
  equityReferenceFeedId: string;
}

/**
 * Built-in registry mapping tokenized equity symbols (xStocks) to both their
 * token feed and underlying equity feed. Verified from /v2/price_feeds on
 * 2026-09-13. These identities do not establish current price availability,
 * mint identity or corporate-action scaling; never substitute the equity feed
 * for a token execution price.
 */
export const XSTOCKS_PYTH_FEEDS: Record<string, StockFeedDefinition> = {
  NVDA: {
    symbol: "NVDA",
    name: "NVIDIA Corporation",
    xStockFeedId:
      "0x4244d07890e4610f46bbde67de8f43a4bf8b569eebe904f136b469f148503b7f", // Crypto.NVDAX/USD
    equityReferenceFeedId:
      "0xb1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593", // Equity.US.NVDA/USD
  },
  AAPL: {
    symbol: "AAPL",
    name: "Apple Inc.",
    xStockFeedId:
      "0x978e6cc68a119ce066aa830017318563a9ed04ec3a0a6439010fc11296a58675", // Crypto.AAPLX/USD
    equityReferenceFeedId:
      "0x49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688", // Equity.US.AAPL/USD
  },
  TSLA: {
    symbol: "TSLA",
    name: "Tesla, Inc.",
    xStockFeedId:
      "0x47a156470288850a440df3a6ce85a55917b813a19bb5b31128a33a986566a362", // Crypto.TSLAX/USD
    equityReferenceFeedId:
      "0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1", // Equity.US.TSLA/USD
  },
  SPY: {
    symbol: "SPY",
    name: "SPDR S&P 500 ETF Trust",
    xStockFeedId:
      "0x2817b78438c769357182c04346fddaad1178c82f4048828fe0997c3c64624e14", // Crypto.SPYX/USD
    equityReferenceFeedId:
      "0x19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5",
  },
  MSFT: {
    symbol: "MSFT",
    name: "Microsoft Corporation",
    xStockFeedId:
      "0xbb723a70af731ab56b9a650eb7e8ac22b7bc07ea77f8670bd1fa9a37bf6df3f5", // Crypto.MSFTX/USD
    equityReferenceFeedId:
      "0xd0ca23c1cc005e004ccf1db5bf76aeb6a49218f43dac3d4b275e92de12ded4d1", // Equity.US.MSFT/USD
  },
  AMZN: {
    symbol: "AMZN",
    name: "Amazon.com, Inc.",
    xStockFeedId:
      "0x7148fbe6e493ff2580305c92a8d7f8628c9943b11b9b253aebc24863fec290e8",
    equityReferenceFeedId:
      "0xb5d0e0fa58a1f8b81498ae670ce93c872d14434b72c364885d4fa1b257cbb07a",
  },
  GOOGL: {
    symbol: "GOOGL",
    name: "Alphabet Inc.",
    xStockFeedId:
      "0xb911b0329028cd0283e4259c33809d62942bd2716a58084e5f31d64c00b5424e",
    equityReferenceFeedId:
      "0x5a48c03e9b9cb337801073ed9d166817473697efff0d138874e0f6a33d6d5aa6",
  },
  META: {
    symbol: "META",
    name: "Meta Platforms, Inc.",
    xStockFeedId:
      "0xbf3e5871be3f80ab7a4d1f1fd039145179fb58569e159aee1ccd472868ea5900",
    equityReferenceFeedId:
      "0x78a3e3b8e676a8f73c439f5d749737034b139bbbe899ba5775216fba596607fe",
  },
};

/**
 * Normalizes a stock symbol (e.g. 'xAAPL', 'AAPLx', 'preOPENAI' -> 'AAPL', 'OPENAI').
 */
export function normalizeSymbol(symbol: string): string {
  const trimmed = symbol.trim();
  const upper = trimmed.toUpperCase();
  if (XSTOCKS_PYTH_FEEDS[upper]) return upper;
  for (const candidate of [upper.replace(/^X/, ""), upper.replace(/X$/, "")])
    if (XSTOCKS_PYTH_FEEDS[candidate]) return candidate;
  // Only explicit lowercase token decorations are removed for unknown symbols.
  // XOM and NFLX are genuine equity symbols, not prefixes/suffixes to strip.
  return trimmed
    .replace(/^pre(?=[A-Z])/, "")
    .replace(/^x(?=[A-Z])/, "")
    .replace(/x$/, "")
    .toUpperCase();
}

/**
 * Resolves a symbol to its Pyth feed configuration.
 */
export function getStockFeedDefinition(
  symbol: string,
): StockFeedDefinition | null {
  const norm = normalizeSymbol(symbol);
  return XSTOCKS_PYTH_FEEDS[norm] || null;
}

/**
 * Returns all supported tokenized stock feed definitions.
 */
export function listSupportedEquities(): StockFeedDefinition[] {
  return Object.values(XSTOCKS_PYTH_FEEDS);
}

/**
 * Official Pyth equity reference feeds for the 12 curated thematic baskets.
 * Verified against Hermes metadata (/v2/price_feeds).
 */
export const BASKET_EQUITY_PYTH_FEEDS: Record<
  string,
  { symbol: string; name: string; equityReferenceFeedId: string }
> = {
  AMD: {
    symbol: "AMD",
    name: "Advanced Micro Devices, Inc.",
    equityReferenceFeedId:
      "0x3622e381dbca2efd1859253763b1adc63f7f9abb8e76da1aa8e638a57ccde93e",
  },
  AVGO: {
    symbol: "AVGO",
    name: "Broadcom Inc.",
    equityReferenceFeedId:
      "0xd0c9aef79b28308b256db7742a0a9b08aaa5009db67a52ea7fa30ed6853f243b",
  },
  TSM: {
    symbol: "TSM",
    name: "Taiwan Semiconductor Manufacturing Company",
    equityReferenceFeedId:
      "0xe722560a66e4ab00522ef20a38fa2ba5d1b41f1c5404723ed895d202a7af7cc4",
  },
  ASML: {
    symbol: "ASML",
    name: "ASML Holding N.V.",
    equityReferenceFeedId:
      "0x1a6e324589a0e355919fb1c0389edc3fdf4c46034626bd82aad4e47714cfa94f",
  },
  CRM: {
    symbol: "CRM",
    name: "Salesforce, Inc.",
    equityReferenceFeedId:
      "0xfeff234600320f4d6bb5a01d02570a9725c1e424977f2b823f7231e6857bdae8",
  },
  ORCL: {
    symbol: "ORCL",
    name: "Oracle Corporation",
    equityReferenceFeedId:
      "0xe47ff732eaeb6b4163902bdee61572659ddf326511917b1423bae93fcdf3153c",
  },
  NOW: {
    symbol: "NOW",
    name: "ServiceNow, Inc.",
    equityReferenceFeedId:
      "0x69d2eebcc3c62889f1c0105ff347f296eb435cba8d2e4705a486fd47a8fe1a1b",
  },
  MCD: {
    symbol: "MCD",
    name: "McDonald's Corporation",
    equityReferenceFeedId:
      "0xd3178156b7c0f6ce10d6da7d347952a672467b51708baaf1a57ffe1fb005824a",
  },
  SBUX: {
    symbol: "SBUX",
    name: "Starbucks Corporation",
    equityReferenceFeedId:
      "0x86cd9abb315081b136afc72829058cf3aaf1100d4650acb2edb6a8e39f03ef75",
  },
  KO: {
    symbol: "KO",
    name: "The Coca-Cola Company",
    equityReferenceFeedId:
      "0x9aa471dccea36b90703325225ac76189baf7e0cc286b8843de1de4f31f9caa7d",
  },
  LLY: {
    symbol: "LLY",
    name: "Eli Lilly and Company",
    equityReferenceFeedId:
      "0x70dcf5fd56553d0023693e4b590336a8c9bcfd0d98dd9f093b1f697820d98325",
  },
  JNJ: {
    symbol: "JNJ",
    name: "Johnson & Johnson",
    equityReferenceFeedId:
      "0x12848738d5db3aef52f51d78d98fc8b8b8450ffb19fb3aeeb67d38f8c147ff63",
  },
  ABBV: {
    symbol: "ABBV",
    name: "AbbVie Inc.",
    equityReferenceFeedId:
      "0x019ae7cb58ee716ebdd1288b057373d60224fc98a9a43ee373c6b0df1f3ffdf5",
  },
  UNH: {
    symbol: "UNH",
    name: "UnitedHealth Group Incorporated",
    equityReferenceFeedId:
      "0x05380f8817eb1316c0b35ac19c3caa92c9aa9ea6be1555986c46dce97fed6afd",
  },
  MRK: {
    symbol: "MRK",
    name: "Merck & Co., Inc.",
    equityReferenceFeedId:
      "0xc81114e16ec3cbcdf20197ac974aed5a254b941773971260ce09e7caebd6af46",
  },
  JPM: {
    symbol: "JPM",
    name: "JPMorgan Chase & Co.",
    equityReferenceFeedId:
      "0x7f4f157e57bfcccd934c566df536f34933e74338fe241a5425ce561acdab164e",
  },
  GS: {
    symbol: "GS",
    name: "The Goldman Sachs Group, Inc.",
    equityReferenceFeedId:
      "0x9c68c0c6999765cf6e27adf75ed551b34403126d3b0d5b686a2addb147ed4554",
  },
  V: {
    symbol: "V",
    name: "Visa Inc.",
    equityReferenceFeedId:
      "0xc719eb7bab9b2bc060167f1d1680eb34a29c490919072513b545b9785b73ee90",
  },
  MA: {
    symbol: "MA",
    name: "Mastercard Incorporated",
    equityReferenceFeedId:
      "0x639db3fe6951d2465bd722768242e68eb0285f279cb4fa97f677ee8f80f1f1c0",
  },
  LMT: {
    symbol: "LMT",
    name: "Lockheed Martin Corporation",
    equityReferenceFeedId:
      "0x880d96a272d5ccbb3cd6f6aacb881a996cb4976b3f252b58c595cd2a418b6ea9",
  },
  RTX: {
    symbol: "RTX",
    name: "RTX Corporation",
    equityReferenceFeedId:
      "0x97c483cc4172de7ac1a3cc0814f442e4747e64008723f2705d6e9fdff3ba4d3d",
  },
  NOC: {
    symbol: "NOC",
    name: "Northrop Grumman Corporation",
    equityReferenceFeedId:
      "0x5f848f61c44e1c9b21ddac0fcac5536344e80ad21df3271c2f069f57229fab81",
  },
  PLTR: {
    symbol: "PLTR",
    name: "Palantir Technologies Inc.",
    equityReferenceFeedId:
      "0x11a70634863ddffb71f2b11f2cff29f73f3db8f6d0b78c49f2b5f4ad36e885f0",
  },
  CAT: {
    symbol: "CAT",
    name: "Caterpillar Inc.",
    equityReferenceFeedId:
      "0xad04597ba688c350a97265fcb60585d6a80ebd37e147b817c94f101a32e58b4c",
  },
  DE: {
    symbol: "DE",
    name: "Deere & Company",
    equityReferenceFeedId:
      "0xc2d23f236142a519929b147c4dbe8720475724918c8b8473db0283f8cf044184",
  },
  GE: {
    symbol: "GE",
    name: "GE Aerospace",
    equityReferenceFeedId:
      "0xe1d3115c6e7ac649faca875b3102f1000ab5e06b03f6903e0d699f0f5315ba86",
  },
  HON: {
    symbol: "HON",
    name: "Honeywell International Inc.",
    equityReferenceFeedId:
      "0x107918baaaafb79cd9df1c8369e44ac21136d95f3ca33f2373b78f24ba1e3e6a",
  },
  XOM: {
    symbol: "XOM",
    name: "Exxon Mobil Corporation",
    equityReferenceFeedId:
      "0x4a1a12070192e8db9a89ac235bb032342a390dde39389b4ee1ba8e41e7eae5d8",
  },
  CVX: {
    symbol: "CVX",
    name: "Chevron Corporation",
    equityReferenceFeedId:
      "0xf464e36fd4ef2f1c3dc30801a9ab470dcdaaa0af14dd3cf6ae17a7fca9e051c5",
  },
  COP: {
    symbol: "COP",
    name: "ConocoPhillips",
    equityReferenceFeedId:
      "0xd54d8d4e3774ea53660e660ecd03aa9daa31eed9b7e67d1a2aed3095b3e6720d",
  },
  QQQ: {
    symbol: "QQQ",
    name: "Invesco QQQ Trust",
    equityReferenceFeedId:
      "0x9695e2b96ea7b3859da9ed25b7a46a920a776e2fdae19a7bcfdf2b219230452d",
  },
  GLD: {
    symbol: "GLD",
    name: "SPDR Gold Shares",
    equityReferenceFeedId:
      "0xe190f467043db04548200354889dfe0d9d314c08b8d4e62fabf4d5a3140fecca",
  },
};

/**
 * Returns the Pyth equity reference feed ID for a symbol, checking both core and basket registries.
 */
export function getEquityFeedId(symbol: string): string | null {
  const norm = normalizeSymbol(symbol);
  return (
    XSTOCKS_PYTH_FEEDS[norm]?.equityReferenceFeedId ??
    BASKET_EQUITY_PYTH_FEEDS[norm]?.equityReferenceFeedId ??
    null
  );
}

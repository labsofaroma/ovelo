import type { BasketConstituentDefinition } from "./types";

export const CANONICAL_BASKET_DEFINITIONS: BasketConstituentDefinition[] = [
  {
    id: "sol-mag7",
    name: "The Magnificent Seven",
    ticker: "SOL-MAG7",
    category: "technology",
    description:
      "Seven large technology and consumer platforms, equally weighted. A concentrated theme whose companies share meaningful technology exposure.",
    symbols: ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA"],
    issuer: "xstocks",
  },
  {
    id: "sol-digital-economy",
    name: "The Digital Economy",
    ticker: "SOL-DIG12",
    category: "technology",
    description:
      "Twelve equal allocations across devices, chips, cloud software and internet platforms. Broad within technology, with substantial sector concentration.",
    symbols: [
      "AAPL",
      "MSFT",
      "NVDA",
      "AMZN",
      "GOOGL",
      "META",
      "TSLA",
      "AMD",
      "AVGO",
      "ORCL",
      "CRM",
      "NFLX",
    ],
    issuer: "xstocks",
  },
  {
    id: "sol-connected-world",
    name: "A Connected World",
    ticker: "SOL-CONNECT",
    category: "technology",
    description:
      "Communication, entertainment and commerce platforms: Alphabet, Meta, Amazon, Netflix and Apple in equal weights. Advertising and consumer demand are shared risks.",
    symbols: ["GOOGL", "META", "AMZN", "NFLX", "AAPL"],
    issuer: "xstocks",
  },
  {
    id: "sol-payment-networks",
    name: "The Payment Rails",
    ticker: "SOL-PAY",
    category: "finance",
    description:
      "Visa, Mastercard and JPMorgan in equal allocations. A focused view on payment networks and banking, exposed to spending and credit cycles.",
    symbols: ["V", "MA", "JPM"],
    issuer: "xstocks",
  },
  {
    id: "sol-consumer-brands",
    name: "Brands We Know",
    ticker: "SOL-BRANDS",
    category: "consumer",
    description:
      "Apple, Amazon, Coca-Cola, McDonald's and Tesla, equally weighted. Familiar brands with distinct business models and consumer-demand risk.",
    symbols: ["AAPL", "AMZN", "KO", "MCD", "TSLA"],
    issuer: "xstocks",
  },
  {
    id: "sol-physical-economy",
    name: "The Physical Economy",
    ticker: "SOL-PHYS",
    category: "industrials",
    description:
      "Equal allocations across aerospace, equipment and energy: Honeywell, Exxon Mobil and Chevron. Sensitive to investment and commodity cycles.",
    symbols: ["HON", "XOM", "CVX"],
    issuer: "xstocks",
  },
  {
    id: "sol-ai-infra",
    name: "Intelligence Layer",
    ticker: "SOL-AI",
    category: "technology",
    description:
      "Compute and cloud platforms behind artificial intelligence. Equal allocations across five companies.",
    symbols: ["NVDA", "MSFT", "GOOGL", "AMZN", "ORCL"],
    issuer: "xstocks",
  },
  {
    id: "sol-chips",
    name: "The Silicon Stack",
    ticker: "SOL-CHIPS",
    category: "technology",
    description:
      "From chip design to fabrication and lithography: five links in the semiconductor supply chain, equally weighted.",
    symbols: ["NVDA", "AMD", "AVGO", "TSM", "ASML"],
    issuer: "xstocks",
  },
  {
    id: "sol-cloud",
    name: "Work in the Cloud",
    ticker: "SOL-CLOUD",
    category: "technology",
    description:
      "Enterprise software, databases and business workflows. Equal allocations across Microsoft, Salesforce, Oracle and ServiceNow.",
    symbols: ["MSFT", "CRM", "ORCL", "NOW"],
    issuer: "xstocks",
  },
  {
    id: "sol-everyday",
    name: "Everyday Economy",
    ticker: "SOL-LIFE",
    category: "consumer",
    description:
      "Devices, shopping, meals and drinks that connect companies to everyday spending. Four equal allocations.",
    symbols: ["AAPL", "AMZN", "MCD", "KO"],
    issuer: "xstocks",
  },
  {
    id: "sol-health",
    name: "Health, Ahead",
    ticker: "SOL-HEALTH",
    category: "healthcare",
    description:
      "Medicines, medical products and healthcare services. Equal exposure across five healthcare companies.",
    symbols: ["LLY", "JNJ", "ABBV", "UNH", "MRK"],
    issuer: "xstocks",
  },
  {
    id: "sol-finance",
    name: "Money in Motion",
    ticker: "SOL-FIN",
    category: "finance",
    description:
      "Banking, capital markets and payment networks. Four equal allocations to the infrastructure of finance.",
    symbols: ["JPM", "GS", "V", "MA"],
    issuer: "xstocks",
  },
  {
    id: "sol-defense",
    name: "Strategic Systems",
    ticker: "SOL-DEF",
    category: "industrials",
    description:
      "Aerospace, defense systems and data software. Equal allocations across Lockheed Martin, Northrop Grumman and Palantir.",
    symbols: ["LMT", "NOC", "PLTR"],
    issuer: "xstocks",
  },
  {
    id: "sol-energy",
    name: "Energy Backbone",
    ticker: "SOL-ENERGY",
    category: "energy",
    description:
      "Two energy producers with equal allocations. A focused energy thesis with exposure to commodity cycles.",
    symbols: ["XOM", "CVX"],
    issuer: "xstocks",
  },
  {
    id: "sol-industry",
    name: "Built to Move",
    ticker: "SOL-BUILD",
    category: "industrials",
    description:
      "Aerospace, manufacturing and industrial systems. Equal allocations across Honeywell, Boeing and 3M.",
    symbols: ["HON", "BA", "MMM"],
    issuer: "xstocks",
  },
  {
    id: "sol-core",
    name: "A Wider Lens",
    ticker: "SOL-CORE",
    category: "diversified",
    description:
      "Equal allocations to S&P 500, Nasdaq-100 and gold exposure through issuer-listed ETF tokens. Index holdings overlap.",
    symbols: ["SPY", "QQQ", "GLD"],
    issuer: "xstocks",
  },
  {
    id: "sol-pre-stocks",
    name: "Private Frontiers",
    ticker: "SOL-PRE",
    category: "private",
    description:
      "Equal allocations across the currently published PreStocks catalog. Private company exposure carries distinct risks.",
    symbols: [],
    issuer: "prestocks",
  },
];

export const REVIEWED_BASKET_DEFINITIONS: BasketConstituentDefinition[] = [
  {
    id: "sol-digital-leaders",
    name: "Digital Leaders",
    ticker: "SOL-DIGITAL",
    category: "technology",
    description:
      "Three equal allocations to Apple, Microsoft and NVIDIA. A focused selection from the largest technology companies.",
    symbols: ["AAPL", "MSFT", "NVDA"],
    issuer: "xstocks",
  },
  {
    id: "sol-ai-focused",
    name: "AI Platforms",
    ticker: "SOL-AI3",
    category: "technology",
    description:
      "NVIDIA, Alphabet and Amazon, equally weighted. A focused selection across AI compute and cloud platforms.",
    symbols: ["NVDA", "GOOGL", "AMZN"],
    issuer: "xstocks",
  },
  {
    id: "sol-everyday-focused",
    name: "Everyday Essentials",
    ticker: "SOL-LIFE3",
    category: "consumer",
    description:
      "Apple, Amazon and Coca-Cola, equally weighted. Three companies spanning devices, shopping and everyday consumption.",
    symbols: ["AAPL", "AMZN", "KO"],
    issuer: "xstocks",
  },
  CANONICAL_BASKET_DEFINITIONS.find(
    (definition) => definition.id === "sol-core",
  )!,
];

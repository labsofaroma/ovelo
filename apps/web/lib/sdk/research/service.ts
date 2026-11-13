import { list, request, row, text } from "./http";
import { cachedResource } from "./cache";
import { calculateResearchTechnicals, parseBars } from "./bars";
import {
  companyDescription,
  normalizeCompanyName,
  privateNews,
} from "./company";
import {
  FUNDAMENTAL_TYPES,
  parseEvents,
  parseFundamentals,
  parseNews,
} from "./fundamentals";
import type {
  RequestOptions,
  ResearchAsset,
  ResearchFundamental,
  ResearchOptions,
  StockResearch,
} from "./types";

const cache = new Map<
  string,
  {
    value: StockResearch;
    expiresAt: number;
    staleUntil: number;
  }
>();
const pending = new Map<string, Promise<StockResearch>>();

/** Public upstream endpoints are best-effort. Missing facts remain absent, never estimated. */
export async function getStockResearch(
  asset: ResearchAsset,
  options: ResearchOptions = {},
): Promise<StockResearch> {
  const symbol = asset.underlyingSymbol.trim().toUpperCase();
  if (!/^[A-Z0-9.^=-]{1,24}$/.test(symbol))
    throw new Error("Unsupported research symbol");
  const key = `${asset.mint}:${symbol}:${asset.kind}:${asset.issuer}`;
  const cached = cache.get(key);
  if (!options.fetcher && !options.now) {
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const inFlight = pending.get(key);
    if (inFlight) {
      if (cached && cached.staleUntil > Date.now()) {
        options.waitUntil?.(inFlight.catch(() => undefined));
        return { ...cached.value, refreshing: true };
      }
      return inFlight;
    }
  }
  if (options.fetcher || options.now)
    return loadStockResearch(asset, symbol, options);
  const operation = (async () => {
    try {
      const value = await loadStockResearch(asset, symbol, options);
      if (cache.size >= 128 && !cache.has(key))
        cache.delete(cache.keys().next().value as string);
      // A provider outage must not erase recently observed research or relabel it fresh.
      if (
        value.status === "unavailable" &&
        cached &&
        cached.staleUntil > Date.now()
      ) {
        const retained = {
          ...cached.value,
          status: "partial" as const,
          refreshing: false,
          warnings: [
            ...new Set([
              ...cached.value.warnings,
              "The research provider is temporarily unavailable. Showing the last observed research; check its date before use.",
            ]),
          ],
        };
        cache.set(key, {
          ...cached,
          value: retained,
          expiresAt: Math.min(Date.now() + 30_000, cached.staleUntil),
        });
        return retained;
      }
      cache.set(key, {
        value,
        expiresAt:
          Date.now() + (value.status === "available" ? 5 * 60_000 : 30_000),
        staleUntil:
          Date.now() + (value.status === "unavailable" ? 30_000 : 15 * 60_000),
      });
      return value;
    } finally {
      pending.delete(key);
    }
  })();
  pending.set(key, operation);
  if (cached && cached.staleUntil > Date.now()) {
    // Attach a rejection handler even when a host does not provide waitUntil.
    const refresh = operation.catch(() => undefined);
    options.waitUntil?.(refresh);
    return { ...cached.value, refreshing: true };
  }
  return operation;
}

async function loadStockResearch(
  asset: ResearchAsset,
  symbol: string,
  baseOptions: ResearchOptions,
): Promise<StockResearch> {
  // All providers share one deadline; optional descriptions cannot add another 8s waterfall.
  const options: RequestOptions = {
    ...baseOptions,
    signal: AbortSignal.timeout(8_000),
  };
  const now = (options.now ?? Date.now)();
  const asOf = new Date(now).toISOString();
  const output: StockResearch = {
    mint: asset.mint,
    symbol,
    asOf,
    status: "unavailable",
    profile: null,
    bars: [],
    technicals: null,
    fundamentals: [],
    events: [],
    news: [],
    sources: [],
    warnings: [],
    refreshing: false,
  };
  if (asset.kind === "pre-ipo" || asset.issuer === "prestocks") {
    const [news, description] = await Promise.allSettled([
      privateNews(asset.name, options),
      companyDescription(asset.name, options),
    ]);
    if (news.status === "fulfilled") {
      output.news = news.value;
      if (output.news.length)
        output.sources.push({
          name: "Google News",
          url: "https://news.google.com/",
        });
    }
    if (description.status === "fulfilled" && description.value) {
      output.profile = {
        name: asset.name,
        description: description.value.description,
        sourceUrl: description.value.sourceUrl,
        observedAt: asOf,
        exchange: null,
        currency: null,
        sector: null,
        industry: null,
        website: null,
      };
      output.sources.push({
        name: "Wikipedia (CC BY-SA)",
        url: description.value.sourceUrl,
      });
    }
    output.warnings.push(
      "This is private-company exposure. Public-stock technicals, financial statements and corporate-action data are unavailable.",
    );
    if (news.status === "rejected")
      output.warnings.push("Company news is temporarily unavailable.");
    output.status =
      output.profile || output.news.length ? "partial" : "unavailable";
    return output;
  }

  // US share-class tickers use a hyphen at Yahoo. Preserve exchange suffixes such as .HK.
  const providerSymbol = /^[A-Z]{1,6}\.[AB]$/.test(symbol)
    ? symbol.replace(".", "-")
    : symbol;
  const encoded = encodeURIComponent(providerSymbol);
  const sourceUrl = `https://finance.yahoo.com/quote/${encoded}/`;
  const historyUrl = `${sourceUrl}history/`;
  const fundamentalsUrl = `${sourceUrl}financials/`;
  const periods = `period1=${Math.floor(now / 1000 - 4 * 366 * 86400)}&period2=${Math.floor(now / 1000)}`;
  const chartRequest = request(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?range=1y&interval=1d&events=div%2Csplits`,
    options,
  );
  const searchRequest = request(
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encoded}&quotesCount=5&newsCount=10`,
    options,
  );
  let descriptionName = "";
  let descriptionRequest: ReturnType<typeof companyDescription> | undefined;
  const startDescription = (name: string): void => {
    if (!name || descriptionRequest) return;
    descriptionName = name;
    descriptionRequest = companyDescription(name, options).catch(() => null);
  };
  // Start optional enrichment as soon as either provider confirms the exact symbol.
  // A slow financial statement response does not hold the description request back.
  void chartRequest.then(
    (payload) => {
      const match = list(row(row(payload).chart).result)
        .map(row)
        .find((item) => row(item.meta).symbol === providerSymbol);
      const metadata = row(match?.meta);
      startDescription(text(metadata.longName) || text(metadata.shortName));
    },
    () => undefined,
  );
  void searchRequest.then(
    (payload) => {
      const match = list(row(payload).quotes)
        .map(row)
        .find((item) => item.symbol === providerSymbol);
      startDescription(text(match?.longname) || text(match?.shortname));
    },
    () => undefined,
  );
  const [chartResult, searchResult, financialResult] = await Promise.allSettled(
    [
      chartRequest,
      searchRequest,
      asset.kind === "etf"
        ? Promise.resolve([] as ResearchFundamental[])
        : cachedResource(
            `financials:${providerSymbol}`,
            options,
            (facts) => (facts.length ? 60 * 60_000 : 30_000),
            async () =>
              parseFundamentals(
                await request(
                  `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encoded}?type=${FUNDAMENTAL_TYPES.map((value) => value.key).join(",")}&${periods}`,
                  options,
                ),
                providerSymbol,
                fundamentalsUrl,
                now,
              ),
          ),
    ],
  );
  const search =
    searchResult.status === "fulfilled" ? row(searchResult.value) : {};
  const quote = list(search.quotes)
    .map(row)
    .find((item) => item.symbol === providerSymbol);
  const chartPayload =
    chartResult.status === "fulfilled" ? row(row(chartResult.value).chart) : {};
  const chart =
    list(chartPayload.result)
      .map(row)
      .find((item) => row(item.meta).symbol === providerSymbol) ?? {};
  const meta = row(chart.meta);
  const companyName =
    text(meta.longName) ||
    text(quote?.longname) ||
    text(meta.shortName) ||
    text(quote?.shortname);
  if (companyName) {
    output.profile = {
      name: companyName,
      exchange: text(meta.fullExchangeName) || text(quote?.exchDisp) || null,
      currency: text(meta.currency) || null,
      sector: text(quote?.sectorDisp) || text(quote?.sector) || null,
      industry: text(quote?.industryDisp) || text(quote?.industry) || null,
      description: null,
      website: null,
      sourceUrl,
      observedAt: asOf,
    };
  }
  output.bars = parseBars(chart, now);
  output.technicals = calculateResearchTechnicals(output.bars, historyUrl);
  output.events = parseEvents(chart, text(meta.currency) || null, historyUrl);
  output.news = parseNews(search, providerSymbol, now);
  // Never attach financial facts to a ticker whose equity identity has not been confirmed.
  const equityConfirmed =
    meta.instrumentType === "EQUITY" || quote?.quoteType === "EQUITY";
  if (financialResult.status === "fulfilled" && equityConfirmed)
    output.fundamentals = financialResult.value;
  if (
    output.profile ||
    output.bars.length ||
    output.news.length ||
    output.fundamentals.length
  )
    output.sources.push({ name: "Yahoo Finance", url: sourceUrl });
  if (!output.bars.length)
    output.warnings.push(
      "Underlying price history and technicals are temporarily unavailable.",
    );
  if (searchResult.status === "rejected")
    output.warnings.push(
      "Company news and classification are temporarily unavailable.",
    );
  if (!output.fundamentals.length)
    output.warnings.push(
      asset.kind === "etf" || meta.instrumentType === "ETF"
        ? "Company financial statements do not apply to this fund."
        : "Reported company financial statements are unavailable from the public provider.",
    );
  if (
    output.profile &&
    normalizeCompanyName(descriptionName) ===
      normalizeCompanyName(output.profile.name)
  ) {
    const description = await descriptionRequest;
    if (description) {
      output.profile.description = description.description;
      output.sources.push({
        name: "Wikipedia (CC BY-SA)",
        url: description.sourceUrl,
      });
    }
  }
  output.status = output.sources.length
    ? output.warnings.length
      ? "partial"
      : "available"
    : "unavailable";
  return output;
}

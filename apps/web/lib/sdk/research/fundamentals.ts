import {
  dateFromSeconds,
  finite,
  list,
  positive,
  row,
  safeUrl,
  text,
  type Row,
} from "./http";
import type { ResearchEvent, ResearchFundamental, ResearchNews } from "./types";

export const FUNDAMENTAL_TYPES = [
  {
    key: "annualTotalRevenue",
    label: "Revenue",
    period: "annual",
    perShare: false,
  },
  {
    key: "annualNetIncome",
    label: "Net income",
    period: "annual",
    perShare: false,
  },
  {
    key: "annualDilutedEPS",
    label: "Diluted EPS",
    period: "annual",
    perShare: true,
  },
  {
    key: "annualTotalAssets",
    label: "Total assets",
    period: "annual",
    perShare: false,
  },
  {
    key: "annualTotalDebt",
    label: "Total debt",
    period: "annual",
    perShare: false,
  },
  {
    key: "annualOperatingCashFlow",
    label: "Operating cash flow",
    period: "annual",
    perShare: false,
  },
  {
    key: "annualFreeCashFlow",
    label: "Free cash flow",
    period: "annual",
    perShare: false,
  },
  {
    key: "quarterlyTotalRevenue",
    label: "Revenue",
    period: "quarterly",
    perShare: false,
  },
  {
    key: "quarterlyNetIncome",
    label: "Net income",
    period: "quarterly",
    perShare: false,
  },
  {
    key: "quarterlyDilutedEPS",
    label: "Diluted EPS",
    period: "quarterly",
    perShare: true,
  },
] as const;

export function parseFundamentals(
  payload: unknown,
  symbol: string,
  sourceUrl: string,
  now: number,
): ResearchFundamental[] {
  const results = list(row(row(payload).timeseries).result).map(row);
  return FUNDAMENTAL_TYPES.flatMap((definition) => {
    const series = results.find(
      (item) =>
        list(row(item.meta).type).includes(definition.key) &&
        list(row(item.meta).symbol).includes(symbol),
    );
    if (!series) return [];
    const facts = list(series[definition.key])
      .map(row)
      .filter((fact) => {
        const value = finite(row(fact.reportedValue).raw);
        return (
          value !== null &&
          /^\d{4}-\d{2}-\d{2}$/.test(text(fact.asOfDate)) &&
          Number.isFinite(Date.parse(text(fact.asOfDate))) &&
          new Date(text(fact.asOfDate)).toISOString().slice(0, 10) ===
            text(fact.asOfDate) &&
          Date.parse(text(fact.asOfDate)) <= now &&
          /^[A-Z]{3}$/.test(text(fact.currencyCode)) &&
          fact.periodType === (definition.period === "annual" ? "12M" : "3M")
        );
      })
      .sort((a, b) => text(b.asOfDate).localeCompare(text(a.asOfDate)));
    const distinctPeriods = [
      ...new Map(facts.map((fact) => [text(fact.asOfDate), fact])).values(),
    ].slice(0, 5);
    return distinctPeriods.map((fact) => ({
      id: definition.key,
      label: definition.label,
      value: row(fact.reportedValue).raw as number,
      unit: `${text(fact.currencyCode)}${definition.perShare ? "/share" : ""}`,
      periodEnd: text(fact.asOfDate),
      period: definition.period,
      sourceUrl,
    }));
  });
}

export function parseEvents(
  chart: Row,
  currency: string | null,
  sourceUrl: string,
): ResearchEvent[] {
  const events = row(chart.events);
  const dividends = Object.entries(row(events.dividends)).flatMap(
    ([id, entry]) => {
      const item = row(entry),
        date = dateFromSeconds(item.date),
        amount = finite(item.amount);
      if (!date || amount === null || amount < 0 || !currency) return [];
      return [
        {
          id: `dividend-${id}`,
          type: "dividend" as const,
          title: "Ex-dividend date",
          date,
          detail: `${amount} ${currency} per underlying share. Token distributions follow the issuer's terms.`,
          sourceUrl,
        },
      ];
    },
  );
  const splits = Object.entries(row(events.splits)).flatMap(([id, entry]) => {
    const item = row(entry),
      date = dateFromSeconds(item.date),
      numerator = positive(item.numerator),
      denominator = positive(item.denominator);
    if (!date || numerator === null || denominator === null) return [];
    return [
      {
        id: `split-${id}`,
        type: "split" as const,
        title: "Stock split",
        date,
        detail: `${numerator}-for-${denominator} underlying stock split.`,
        sourceUrl,
      },
    ];
  });
  return [...dividends, ...splits]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 12);
}

export function parseNews(
  payload: unknown,
  symbol: string,
  now: number,
): ResearchNews[] {
  return list(row(payload).news)
    .flatMap((value) => {
      const item = row(value),
        title = text(item.title),
        url = safeUrl(item.link),
        publishedAt = dateFromSeconds(item.providerPublishTime);
      if (
        !title ||
        !url ||
        !publishedAt ||
        Date.parse(publishedAt) > now + 60_000 ||
        !list(item.relatedTickers).includes(symbol)
      )
        return [];
      return [
        { title, url, publishedAt, publisher: text(item.publisher) || null },
      ];
    })
    .slice(0, 8);
}

import {
  Badge,
  EmptyState,
  StatTile,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@ovelo/ui";
import { ArrowUpRight, CalendarDays } from "lucide-react";
import { AsOf } from "../../shared/components/AsOf";
import {
  formatCompactUsd,
  formatUnitsText,
  formatUsd,
} from "../../shared/fixed";
import { formatDay, STALE_AFTER_MS } from "../../shared/freshness";
import { textLink } from "../../shared/styles";
import type { ResearchView } from "../schema";
import { ResearchRange } from "./ResearchRange";

const tileLink =
  "focus-ring flex rounded-tile border border-line bg-raised p-4 transition-colors motion-fast hover:border-border-strong";

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-tile border border-line bg-raised p-4">
      <dt className="text-caption text-muted">{label}</dt>
      <dd className="text-small font-medium text-ink [overflow-wrap:anywhere]">
        {value ?? "Not reported"}
      </dd>
    </div>
  );
}

export function OverviewPanel({ research }: { research: ResearchView }) {
  const { profile } = research;
  if (!profile) return <EmptyState title="No company profile was found." />;
  return (
    <div className="flex flex-col gap-5">
      {profile.description ? (
        <p className="max-w-[72ch] text-body leading-body text-ink">
          {profile.description}
        </p>
      ) : null}
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Fact label="Exchange" value={profile.exchange} />
        <Fact label="Sector" value={profile.sector} />
        <Fact label="Industry" value={profile.industry} />
        <Fact label="Currency" value={profile.currency} />
        <Fact
          label="Website"
          value={
            profile.website ? (
              <a
                className={textLink}
                href={profile.website}
                rel="noreferrer"
                target="_blank"
              >
                {new URL(profile.website).hostname}
              </a>
            ) : null
          }
        />
      </dl>
      <AsOf
        observedAt={profile.observedAt}
        source="Company profile"
        sourceUrl={profile.sourceUrl}
        staleAfterMs={STALE_AFTER_MS.research}
        label="Observed"
      />
    </div>
  );
}

const TREND = {
  "above-50-day": "Close above its 50-day average",
  "below-50-day": "Close below its 50-day average",
  "at-50-day": "Close at its 50-day average",
  unavailable: "Not enough history",
} as const;

export function TechnicalsPanel({ research }: { research: ResearchView }) {
  const t = research.technicals;
  if (!t) return <EmptyState title="Technicals are unavailable." />;
  const usd = (value: typeof t.close | null) =>
    value ? formatUsd(value) : "Not reported";
  const metrics = [
    ["Last close", usd(t.close)],
    ["50-day average", usd(t.sma50)],
    ["200-day average", usd(t.sma200)],
    ["RSI (14)", t.rsi14 ? formatUnitsText(t.rsi14, 1) : "Not reported"],
  ] as const;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {metrics.map(([label, value]) => (
          <StatTile key={label} label={label} value={value} />
        ))}
      </div>
      <div className="flex flex-col gap-3 rounded-tile border border-line bg-raised p-4 md:flex-row md:items-center">
        <Badge
          tone={t.trend === "unavailable" ? "neutral" : "accent"}
          className="w-fit shrink-0"
        >
          <span className="sr-only">Trend: </span>
          {TREND[t.trend]}
        </Badge>
        <p className="text-small leading-body text-muted">
          Computed from daily closes of the underlying share, not the token. Not
          a recommendation.
        </p>
      </div>
      <ResearchRange
        label="52-week range"
        low={t.low52w}
        high={t.high52w}
        current={t.close}
      />
      <AsOf
        observedAt={t.asOf}
        source="Yahoo Finance daily closes"
        sourceUrl={t.sourceUrl}
        staleAfterMs={STALE_AFTER_MS.research}
        label="Close of"
      />
    </div>
  );
}

export function FinancialsPanel({ research }: { research: ResearchView }) {
  if (!research.fundamentals.length)
    return <EmptyState title="No reported financials were found." />;
  return (
    <Table>
      <TableCaption className="text-left">
        As reported for the underlying company. Source links per row.
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Item</TableHead>
          <TableHead scope="col">Period end</TableHead>
          <TableHead scope="col" className="text-right">
            Value
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {research.fundamentals.map((item) => (
          <TableRow key={item.id}>
            <TableCell>
              <a
                className={textLink}
                href={item.sourceUrl}
                rel="noreferrer"
                target="_blank"
              >
                {item.label} ({item.period})
              </a>
            </TableCell>
            <TableCell>{formatDay(item.periodEnd) ?? item.periodEnd}</TableCell>
            <TableCell className="text-right tabular-nums">
              {item.unit === "USD"
                ? formatCompactUsd(item.value)
                : `${formatUnitsText(item.value, 2)} ${item.unit}`}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function EventsPanel({ research }: { research: ResearchView }) {
  if (!research.events.length)
    return <EmptyState title="No dividends, splits or filings were found." />;
  return (
    <ul className="flex flex-col gap-3">
      {research.events.map((event) => (
        <li key={event.id}>
          <a
            className={`${tileLink} items-start gap-4`}
            href={event.sourceUrl}
            rel="noreferrer"
            target="_blank"
          >
            <span
              aria-hidden="true"
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-raised-2 text-muted"
            >
              <CalendarDays className="size-4" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-caption text-muted">
                {formatDay(event.date) ?? event.date}
              </span>
              <span className="font-medium text-ink">{event.title}</span>
              <span className="text-small text-muted">{event.detail}</span>
            </span>
            <ArrowUpRight aria-hidden="true" className="size-4 text-muted" />
          </a>
        </li>
      ))}
    </ul>
  );
}

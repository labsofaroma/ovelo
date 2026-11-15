import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@ovelo/ui";
import { AsOf } from "../../shared/components/AsOf";
import {
  formatCompactUsd,
  formatUnitsText,
  formatUsd,
} from "../../shared/fixed";
import { formatDay, STALE_AFTER_MS } from "../../shared/freshness";
import { textLink } from "../../shared/styles";
import type { ResearchView } from "../schema";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-2">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-semibold tabular-nums">
        {value ?? "Not reported"}
      </dd>
    </div>
  );
}

export function OverviewPanel({ research }: { research: ResearchView }) {
  const { profile } = research;
  if (!profile)
    return (
      <p className="text-small text-muted">No company profile was found.</p>
    );
  return (
    <div className="flex flex-col gap-3">
      {profile.description ? (
        <p className="max-w-3xl">{profile.description}</p>
      ) : null}
      <dl className="grid max-w-xl text-small">
        <Row label="Exchange" value={profile.exchange} />
        <Row label="Sector" value={profile.sector} />
        <Row label="Industry" value={profile.industry} />
        <Row label="Currency" value={profile.currency} />
        <Row
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
  if (!t)
    return <p className="text-small text-muted">Technicals are unavailable.</p>;
  const usd = (value: typeof t.close | null) =>
    value ? formatUsd(value) : null;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-small text-muted">
        Computed from daily closes of the underlying share, not the token. Not a
        recommendation.
      </p>
      <dl className="grid max-w-xl text-small">
        <Row label="Last close" value={usd(t.close)} />
        <Row label="50-day average" value={usd(t.sma50)} />
        <Row label="200-day average" value={usd(t.sma200)} />
        <Row
          label="RSI (14)"
          value={t.rsi14 ? formatUnitsText(t.rsi14, 1) : null}
        />
        <Row label="52-week high" value={usd(t.high52w)} />
        <Row label="52-week low" value={usd(t.low52w)} />
        <Row label="Trend" value={TREND[t.trend]} />
      </dl>
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
    return (
      <p className="text-small text-muted">
        No reported financials were found.
      </p>
    );
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
            <TableCell className="text-right">
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
    return (
      <p className="text-small text-muted">
        No dividends, splits or filings were found.
      </p>
    );
  return (
    <ul className="flex flex-col divide-y divide-line">
      {research.events.map((event) => (
        <li key={event.id} className="flex flex-col gap-1 py-3 text-small">
          <a
            className={textLink}
            href={event.sourceUrl}
            rel="noreferrer"
            target="_blank"
          >
            {event.title}
          </a>
          <span className="text-caption text-muted">
            {formatDay(event.date) ?? event.date} · {event.detail}
          </span>
        </li>
      ))}
    </ul>
  );
}

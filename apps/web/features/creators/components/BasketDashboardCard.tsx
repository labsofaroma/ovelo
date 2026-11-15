"use client";

import { Badge, Button } from "@aroma/ui";
import Link from "next/link";
import { useState } from "react";
import { formatObservedAt } from "../../shared/freshness";
import { dashboardCopy as copy } from "../copy";
import type { DashboardBasket } from "../dashboard-schema";
import { creatorRoutes } from "../routes";
import { volumeText } from "./CreatorUsage";

/** One basket on the dashboard: usage by period, Blink share, versions, and actions. */
export function BasketDashboardCard({
  basket,
  origin,
  onArchive,
  archiving,
}: {
  basket: DashboardBasket;
  origin: string;
  onArchive: (id: string) => void;
  archiving: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const link = `${origin}${creatorRoutes.basket(basket.id)}`;
  const share = encodeURIComponent(link);
  const headingId = `basket-${basket.id}`;
  const copyLink = async () => {
    await navigator.clipboard?.writeText(link).catch(() => undefined);
    setCopied(true);
  };
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-section font-semibold">
          {basket.name}{" "}
          <span className="text-small font-normal text-muted">
            {basket.ticker}
          </span>
        </h2>
        <Badge tone={basket.status === "published" ? "up" : "neutral"}>
          {copy.status[basket.status]}
        </Badge>
      </div>

      {basket.usage.state === "unavailable" ? (
        <p className="text-small text-muted">{basket.usage.reason}</p>
      ) : basket.usage.state === "none" ? (
        <p className="text-small">{copy.noBuys}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-small">
            <caption className="sr-only">{`${basket.name}: confirmed buys by period`}</caption>
            <thead>
              <tr className="text-left text-caption text-muted">
                <th scope="col" className="py-1.5 font-normal">
                  {copy.columns.period}
                </th>
                <th scope="col" className="py-1.5 text-right font-normal">
                  {copy.columns.buys}
                </th>
                <th scope="col" className="py-1.5 text-right font-normal">
                  {copy.columns.buyers}
                </th>
                <th scope="col" className="py-1.5 text-right font-normal">
                  {copy.columns.volume}
                </th>
                <th scope="col" className="py-1.5 text-right font-normal">
                  {copy.columns.blink}
                </th>
              </tr>
            </thead>
            <tbody>
              {basket.usage.windows.map((w) => {
                const blink = basket.blink.find((b) => b.window === w.window);
                return (
                  <tr key={w.window} className="border-t border-line">
                    <th scope="row" className="py-1.5 text-left font-normal">
                      {copy.windows[w.window]}
                    </th>
                    <td className="py-1.5 text-right tabular-nums">
                      {w.purchases}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {w.buyers}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {volumeText(w.volume)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {blink
                        ? copy.blink(
                            blink.viaAction,
                            blink.tracked,
                            blink.untracked,
                          )
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-small">
        <h3 className="font-semibold">{copy.versions}</h3>
        {basket.versions.length === 0 ? (
          <p className="text-muted">{copy.noVersions}</p>
        ) : (
          <ul className="mt-1 grid gap-1">
            {basket.versions.map((v) => (
              <li key={v.version}>
                {copy.version(
                  v.version,
                  formatObservedAt(v.publishedAt) ?? v.publishedAt,
                )}
                :{" "}
                <span className="text-muted">
                  {v.allocations
                    .map((a) => `${a.symbol} ${a.weightBps / 100}%`)
                    .join(", ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-small text-muted">
        {copy.feeShare}. {copy.feeShareNote(basket.feeShare.entries)}
      </p>

      <div className="flex flex-wrap items-center gap-3 text-small">
        {basket.status === "published" ? (
          <>
            <Button variant="secondary" size="sm" onClick={copyLink}>
              {copied ? copy.copied : copy.copyLink}
            </Button>
            <a
              className="underline"
              target="_blank"
              rel="noopener noreferrer"
              href={`https://twitter.com/intent/tweet?url=${share}`}
            >
              {copy.shareX}
            </a>
            <a
              className="underline"
              target="_blank"
              rel="noopener noreferrer"
              href={`https://t.me/share/url?url=${share}`}
            >
              {copy.shareTelegram}
            </a>
          </>
        ) : null}
        {basket.status !== "archived" ? (
          <Link className="underline" href={creatorRoutes.edit(basket.id)}>
            {basket.status === "draft" ? copy.publishDraft : copy.edit}
          </Link>
        ) : null}
        {basket.status === "published" ? (
          <Button
            variant="ghost"
            size="sm"
            loading={archiving}
            onClick={() => {
              if (window.confirm(copy.archiveConfirm)) onArchive(basket.id);
            }}
          >
            {copy.archive}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

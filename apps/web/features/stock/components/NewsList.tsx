import { EmptyState } from "@ovelo/ui";
import { ArrowUpRight } from "lucide-react";
import { formatDay } from "../../shared/freshness";
import type { ResearchView } from "../schema";

/** Headlines as published by their source. Never summarised or rewritten. */
export function NewsList({ news }: { news: ResearchView["news"] }) {
  if (!news.length)
    return <EmptyState title="No recent news was found for this company." />;
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {news.map((item) => (
        <li key={item.url}>
          <a
            href={item.url}
            rel="noreferrer"
            target="_blank"
            className="focus-ring flex h-full flex-col gap-3 rounded-tile border border-line bg-raised p-4 transition-colors motion-fast hover:border-border-strong"
          >
            <span className="flex items-center justify-between gap-3 text-caption text-muted">
              {item.publisher ?? "Publisher not stated"}
              <ArrowUpRight aria-hidden="true" className="size-4 shrink-0" />
            </span>
            <span className="font-display text-body font-medium leading-snug text-ink">
              {item.title}
            </span>
            {item.publishedAt ? (
              <time
                dateTime={item.publishedAt}
                className="mt-auto text-caption text-muted"
              >
                {formatDay(item.publishedAt)}
              </time>
            ) : null}
          </a>
        </li>
      ))}
    </ul>
  );
}

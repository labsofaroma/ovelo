import { formatDay } from "../../shared/freshness";
import type { ResearchView } from "../schema";

/** Headlines as published by their source. Never summarised or rewritten. */
export function NewsList({ news }: { news: ResearchView["news"] }) {
  if (!news.length)
    return (
      <p className="text-small text-muted">
        No recent news was found for this company.
      </p>
    );
  return (
    <ul className="flex flex-col divide-y divide-line">
      {news.map((item) => (
        <li key={item.url} className="flex flex-col gap-1 py-3">
          <a
            href={item.url}
            rel="noreferrer"
            target="_blank"
            className="text-body font-semibold text-ink underline-offset-2 hover:underline focus-ring rounded-badge"
          >
            {item.title}
          </a>
          <p className="text-caption text-muted">
            {item.publisher ?? "Publisher not stated"}
            {item.publishedAt ? (
              <>
                {" · "}
                <time dateTime={item.publishedAt}>
                  {formatDay(item.publishedAt)}
                </time>
              </>
            ) : null}
          </p>
        </li>
      ))}
    </ul>
  );
}

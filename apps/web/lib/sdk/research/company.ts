import { request, row, safeUrl, text } from "./http";
import { cachedResource } from "./cache";
import type { RequestOptions, ResearchNews } from "./types";

export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(
      /\b(incorporated|inc|corporation|corp|limited|ltd|plc|company|co|holdings)\b/g,
      "",
    )
    .replace(/[^a-z0-9]/g, "");
}

export async function companyDescription(
  name: string,
  options: RequestOptions,
): Promise<{ description: string; sourceUrl: string } | null> {
  return cachedResource(
    `description:${name.toLowerCase()}`,
    options,
    (value) => (value ? 24 * 60 * 60_000 : 5 * 60_000),
    async () => {
      // MediaWiki generators return search matches and their extracts in one round trip.
      const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(name)}&gsrlimit=3&prop=extracts%7Cpageprops&exintro=1&explaintext=1&exlimit=3&format=json&utf8=1`;
      const search = row(await request(searchUrl, options));
      const targetName = normalizeCompanyName(name);
      // Exact normalized names only: never attach an unrelated search result's company facts.
      const match = Object.values(row(row(search.query).pages))
        .map(row)
        .find(
          (item) =>
            targetName.length >= 3 &&
            !Object.hasOwn(row(item.pageprops), "disambiguation") &&
            normalizeCompanyName(text(item.title)) === targetName,
        );
      if (!match || !Number.isSafeInteger(match.pageid)) return null;
      const description = text(match.extract)
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 2)
        .join("\n\n");
      if (!description) return null;
      return {
        description:
          description.length > 1_200
            ? `${description.slice(0, 1_197).replace(/\s+\S*$/, "")}…`
            : description,
        sourceUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(text(match.title).replace(/ /g, "_"))}`,
      };
    },
  );
}

function xmlText(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(
      /&(amp|lt|gt|quot|apos);/g,
      (_, entity: string) =>
        ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[entity] ?? "",
    )
    .trim();
}

export async function privateNews(
  name: string,
  options: RequestOptions,
): Promise<ResearchNews[]> {
  const query = `"${name.replace(/["<>]/g, "")}" company`;
  const xml = text(
    await request(
      `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`,
      options,
      "text",
    ),
  );
  if (!/<rss\b/i.test(xml))
    throw new Error("News provider did not return an RSS feed");
  return [...xml.matchAll(/<item>[\s\S]*?<\/item>/g)]
    .slice(0, 8)
    .flatMap(([item]) => {
      const field = (tag: string): string =>
        xmlText(
          item.match(
            new RegExp(`<${tag}(?: [^>]*)?>([\\s\\S]*?)<\\/${tag}>`),
          )?.[1] ?? "",
        );
      const publisher = field("source") || null;
      let title = field("title");
      if (publisher && title.endsWith(` - ${publisher}`))
        title = title.slice(0, -(publisher.length + 3));
      const url = safeUrl(field("link"));
      const published = Date.parse(field("pubDate"));
      return title && url
        ? [
            {
              title,
              url,
              publisher,
              publishedAt: Number.isFinite(published)
                ? new Date(published).toISOString()
                : null,
            },
          ]
        : [];
    });
}

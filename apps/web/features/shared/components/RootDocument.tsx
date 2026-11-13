import type { ReactNode } from "react";
import { headers } from "next/headers";
import { themeInitScript } from "@aroma/ui/theme";
import { ConsentBanner } from "./ConsentBanner";

/**
 * The v1 root document (M4, REWRITE-PLAN §4). `(app)` and `(marketing)` are root layouts of
 * their own, so /v1 no longer loads the prototype's root providers, its global CSS or
 * `@solana/web3.js` (M3 finding 1). The inline theme script carries the per-request CSP nonce set
 * by middleware (no 'unsafe-inline' for scripts); reading it makes v1 HTML dynamic, while
 * provider data stays in the Next data cache.
 */
export async function RootDocument({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      {/* An App Router root layout renders <head> itself; next/head is Pages Router only. */}
      {/* eslint-disable-next-line @next/next/no-head-element */}
      <head>
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
      </head>
      <body className="bg-bg text-ink antialiased">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-surface focus:px-4 focus:py-2 focus-ring"
        >
          Skip to content
        </a>
        {children}
        <ConsentBanner />
      </body>
    </html>
  );
}

/** metadataBase for v1 (port of lib/site.ts siteUrl; invalid values fall back to localhost). */
export function v1SiteUrl(): URL {
  const configured =
    process.env.AROMA_SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000");
  try {
    const url = new URL(configured);
    if (url.username || url.password || !/^https?:$/.test(url.protocol))
      throw new Error("invalid");
    return new URL(url.origin);
  } catch {
    return new URL("http://localhost:3000");
  }
}

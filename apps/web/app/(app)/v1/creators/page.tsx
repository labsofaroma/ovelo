import type { Metadata } from "next";
import Link from "next/link";
import { CreatorBasketCard } from "@/features/creators/components/CreatorBasketCard";
import { getDirectory } from "@/features/creators/directory";
import { creatorRoutes } from "@/features/creators/routes";
import { DataNotice } from "@/features/shared/components/DataNotice";
import { plural } from "@/features/shared/fixed";
import { formatObservedAt } from "@/features/shared/freshness";
import { v1Metadata } from "@/features/shared/metadata";
import { linkButton, pageContainer } from "@/features/shared/styles";
import { assertV1Enabled } from "@/features/shared/v1";

// Read on every request: a newly published basket must appear immediately, and the database is
// never touched at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = v1Metadata({
  title: "Creator baskets",
  description:
    "Baskets published by invited creators: who made each one, its version and its exact weights.",
  path: creatorRoutes.directory,
});

export default async function CreatorsPage() {
  assertV1Enabled();
  const directory = await getDirectory();
  return (
    <main
      id="main-content"
      className={`${pageContainer} flex flex-col gap-6 py-8`}
    >
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-2">
          <h1 className="text-page font-semibold max-md:text-page-mobile">
            Creator baskets
          </h1>
          <p className="text-body text-muted">
            Baskets published by invited creators, each signed by the
            creator&rsquo;s wallet. Weights are exactly as published. Aroma does
            not review or endorse them.
          </p>
        </div>
        <Link className={linkButton.secondary} href={creatorRoutes.builder}>
          Build a basket
        </Link>
      </header>
      {directory.state === "unavailable" ? (
        <DataNotice
          tone="unavailable"
          title="The creator directory is unavailable right now"
        >
          <p>
            Published baskets could not be loaded. {directory.error.message}
          </p>
        </DataNotice>
      ) : (
        <>
          <p className="text-caption text-muted">
            {plural(directory.data.baskets.length, "published basket")} ·
            Source: {directory.data.source} · As of{" "}
            {formatObservedAt(directory.data.asOf) ?? directory.data.asOf}.
            Purchases of each basket, from confirmed receipts, are on its page.
          </p>
          {directory.data.baskets.length ? (
            <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {directory.data.baskets.map((basket) => (
                <CreatorBasketCard key={basket.id} basket={basket} />
              ))}
            </ul>
          ) : (
            <p className="rounded-panel border border-dashed border-line p-6 text-body text-muted">
              No creator has published a basket yet.
            </p>
          )}
        </>
      )}
    </main>
  );
}

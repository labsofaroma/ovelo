import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Plus } from "lucide-react";
import { EmptyState, Section, Stack } from "@ovelo/ui";
import { dashboardCopy } from "@/features/creators/copy";
import { CreatorBasketCard } from "@/features/creators/components/CreatorBasketCard";
import { getDirectory } from "@/features/creators/directory";
import { creatorRoutes } from "@/features/creators/routes";
import { DataNotice } from "@/features/shared/components/DataNotice";
import { plural } from "@/features/shared/fixed";
import { formatObservedAt } from "@/features/shared/freshness";
import { v1Metadata } from "@/features/shared/metadata";
import {
  linkButton,
  linkButtonSmall,
  pageContainer,
} from "@/features/shared/styles";

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
  const directory = await getDirectory();
  return (
    <main id="main-content" className={pageContainer}>
      <Stack>
        <Section
          variant="hero"
          headingLevel="h1"
          eyebrow="Creator studio"
          title="Creator baskets"
          description={
            <>
              Baskets published by invited creators, each signed by the
              creator&rsquo;s wallet. Weights are exactly as published. Ovelo
              does not review or endorse them.
            </>
          }
          actions={
            <>
              <Link className={linkButton.primary} href={creatorRoutes.builder}>
                <Plus className="size-4" aria-hidden="true" />
                Build a basket
              </Link>
              <Link
                className={linkButton.secondary}
                href={creatorRoutes.dashboard}
              >
                {dashboardCopy.title}
                <ArrowUpRight className="size-4" aria-hidden="true" />
              </Link>
            </>
          }
        />
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
          <Section
            title="Published baskets"
            description="Purchases of each basket, from confirmed receipts, are on its page."
          >
            <div className="flex flex-col gap-4">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted">
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full bg-up"
                />
                <span>
                  {plural(directory.data.baskets.length, "published basket")} ·
                  Source: {directory.data.source} · As of{" "}
                  <time dateTime={directory.data.asOf}>
                    {formatObservedAt(directory.data.asOf) ??
                      directory.data.asOf}
                  </time>
                </span>
              </p>
              {directory.data.baskets.length ? (
                <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {directory.data.baskets.map((basket) => (
                    <CreatorBasketCard key={basket.id} basket={basket} />
                  ))}
                </ul>
              ) : (
                <EmptyState
                  title="No creator has published a basket yet."
                  action={
                    <Link
                      className={linkButtonSmall.secondary}
                      href={creatorRoutes.builder}
                    >
                      Start a draft
                    </Link>
                  }
                />
              )}
            </div>
          </Section>
        )}
      </Stack>
    </main>
  );
}

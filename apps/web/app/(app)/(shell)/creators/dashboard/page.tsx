import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { NetworkBadge, Section, Stack } from "@ovelo/ui";
import { dashboardCopy } from "@/features/creators/copy";
import { DashboardIsland } from "@/features/creators/components/DashboardIsland";
import { creatorRoutes } from "@/features/creators/routes";
import { v1Metadata } from "@/features/shared/metadata";
import { linkButtonSmall, pageContainer } from "@/features/shared/styles";
import { PageHeader } from "@/features/shell/PageHeader";

export const dynamic = "force-dynamic";

export const metadata: Metadata = v1Metadata({
  title: dashboardCopy.title,
  description:
    "Your creator baskets' purchases, Blink share and version history.",
  path: "/creators/dashboard",
  // Per wallet: nothing to index.
  noindex: true,
});

export default function CreatorDashboardPage() {
  const origin = (process.env.OVELO_SITE_URL ?? "").replace(/\/$/, "");
  return (
    <main id="main-content" className={pageContainer}>
      <Stack>
        <PageHeader
          eyebrow="Creator studio"
          title={dashboardCopy.title}
          description={dashboardCopy.intro}
          actions={
            <Link
              className={linkButtonSmall.ghost}
              href={creatorRoutes.directory}
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              Creator baskets
            </Link>
          }
        />
        <Section
          title="Your baskets"
          actions={<NetworkBadge kind="mainnet-spot" />}
        >
          <DashboardIsland origin={origin} />
        </Section>
      </Stack>
    </main>
  );
}

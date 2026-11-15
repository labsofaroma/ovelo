import type { Metadata } from "next";
import { dashboardCopy } from "@/features/creators/copy";
import { DashboardIsland } from "@/features/creators/components/DashboardIsland";
import { v1Metadata } from "@/features/shared/metadata";
import { pageContainer } from "@/features/shared/styles";

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
    <main
      id="main-content"
      className={`${pageContainer} flex max-w-4xl flex-col gap-6 py-8`}
    >
      <div className="flex flex-col gap-1">
        <h1 className="text-page font-semibold max-md:text-page-mobile">
          {dashboardCopy.title}
        </h1>
        <p className="text-small text-muted">{dashboardCopy.intro}</p>
      </div>
      <DashboardIsland origin={origin} />
    </main>
  );
}

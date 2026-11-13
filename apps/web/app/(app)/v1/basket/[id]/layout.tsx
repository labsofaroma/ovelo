import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { basketIdSchema } from "@/features/baskets/schema";
import { getMarkets } from "@/features/markets/server";
import { assertV1Enabled } from "@/features/shared/v1";

/** Real 404 status for unknown ids (see the stock layout). An outage is not a 404. */
export default async function BasketLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  // Gate before any data access: with the flag off nothing may reach the markets server.
  assertV1Enabled();
  const id = basketIdSchema.safeParse((await params).id.toLowerCase());
  if (!id.success) notFound();
  const markets = await getMarkets();
  if (
    markets.state === "ok" &&
    !markets.data.baskets.some((b) => b.id === id.data)
  )
    notFound();
  return children;
}

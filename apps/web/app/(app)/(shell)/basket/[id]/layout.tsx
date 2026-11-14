import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { basketIdSchema } from "@/features/baskets/schema";
import { getMarkets } from "@/features/markets/server";
import { lookupCreatorBasket } from "@/features/creators/basket-page";
import { creatorBasketId } from "@/features/trade/server/creator-target";

/** Real 404 status for unknown ids (see the stock layout). An outage is not a 404. */
export default async function BasketLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const raw = (await params).id;
  // Creator baskets (UUIDs) live in Postgres. Unknown or draft: 404. Registry outage: not a 404.
  const creatorId = creatorBasketId(raw);
  if (creatorId) {
    if ((await lookupCreatorBasket(creatorId)) === null) notFound();
    return children;
  }
  const id = basketIdSchema.safeParse(raw.toLowerCase());
  if (!id.success) notFound();
  const markets = await getMarkets();
  if (
    markets.state === "ok" &&
    !markets.data.baskets.some((b) => b.id === id.data)
  )
    notFound();
  return children;
}

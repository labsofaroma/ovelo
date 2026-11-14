import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getAsset } from "@/features/markets/server";
import { assertV1Enabled } from "@/features/shared/v1";
import { symbolParamSchema } from "@/features/stock/schema";

/**
 * Decides "not found" BEFORE loading.tsx's Suspense boundary starts streaming, so an unknown
 * symbol gets a real 404 status (a notFound() inside a streamed page is sent with 200). The lookup
 * reads the same cached snapshot as the page. An outage is not a 404: the page explains it.
 */
export default async function StockLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ symbol: string }>;
}) {
  // Gate before any data access: with the flag off nothing may reach the markets server.
  assertV1Enabled();
  const parsed = symbolParamSchema.safeParse((await params).symbol);
  if (!parsed.success) notFound();
  const lookup = await getAsset(parsed.data);
  if (lookup.state === "not-found") notFound();
  return children;
}

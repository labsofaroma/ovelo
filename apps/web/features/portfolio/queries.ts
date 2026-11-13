"use client";

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { TradeApiError } from "../trade/api";
import { activityItemSchema, portfolioViewSchema } from "./schema";

/** TanStack Query for GET /api/v1/portfolio/:wallet (zod-parsed; errors are `{ code, message }`). */
const responseSchema = z.object({
  portfolio: portfolioViewSchema,
  activity: z.array(activityItemSchema).nullable(),
});
export type PortfolioResponse = z.infer<typeof responseSchema>;

async function fetchPortfolio(wallet: string): Promise<PortfolioResponse> {
  const response = await fetch(
    `/api/v1/portfolio/${encodeURIComponent(wallet)}`,
    {
      cache: "no-store",
    },
  );
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body as { code?: string; message?: string } | null;
    throw new TradeApiError(
      error?.code ?? "INTERNAL",
      error?.message ?? "The portfolio could not be loaded.",
    );
  }
  return responseSchema.parse(body);
}

export function usePortfolio(wallet: string | null) {
  return useQuery({
    queryKey: ["portfolio", wallet],
    queryFn: () => fetchPortfolio(wallet!),
    enabled: Boolean(wallet),
    refetchInterval: 60_000,
  });
}

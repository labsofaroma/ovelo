"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { tradeApi } from "./api";
import type { QuoteRequestBody, SubmitRequestBody } from "./schema";

/** TanStack Query v5 server state for trading (REWRITE-PLAN §3). */
export const tradeKeys = {
  status: (id: string) => ["trade", "status", id] as const,
  prices: (mints: readonly string[]) => ["prices", ...mints] as const,
};

export function useQuoteMutation() {
  return useMutation({
    mutationFn: (body: QuoteRequestBody) => tradeApi.quote(body),
    retry: false,
  });
}

export function useSubmitMutation() {
  return useMutation({
    mutationFn: (body: SubmitRequestBody) => tradeApi.submit(body),
    // Never retried automatically: the server is idempotent, but the user must see the outcome.
    retry: false,
  });
}

/** Polls a submitted trade until it is final (confirmed or failed). */
export function useTradeStatus(id: string | null) {
  return useQuery({
    queryKey: tradeKeys.status(id ?? "none"),
    queryFn: () => tradeApi.status(id!),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "confirmed" || status === "failed" ? false : 2_000;
    },
    retry: 3,
  });
}

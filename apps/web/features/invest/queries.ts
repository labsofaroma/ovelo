"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { assertSignerCluster, type WalletCluster } from "../wallet/cluster";
import type { Signer } from "../wallet/context";
import { investApi } from "./api";
import type { PreparedTransaction, SubmitResponse } from "./schema";

/** TanStack Query hooks for /v1/invest. Server state only; the chain is the source of truth. */

export const plansKey = (owner: string | null) =>
  ["invest", "plans", owner] as const;

/** The owner's plans; refetched every 15 s while the page is visible. */
export function usePlans(owner: string | null) {
  return useQuery({
    queryKey: plansKey(owner),
    queryFn: () => investApi.plans(owner!),
    enabled: Boolean(owner),
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
}

export type FlowStep =
  | { step: "idle" }
  | { step: "preparing" }
  | { step: "review"; prepared: PreparedTransaction }
  | { step: "signing"; prepared: PreparedTransaction }
  | { step: "submitting"; prepared: PreparedTransaction }
  | { step: "done"; result: SubmitResponse }
  | { step: "error"; message: string };

/**
 * prepare → review → sign in the wallet → submit. The signer must be the boundary's cluster's
 * (assertSignerCluster); the server re-verifies the bytes and the signature.
 */
export function useSignedPlanFlow(options: {
  cluster: WalletCluster;
  signer: Signer | null;
  /** Refetch the plan list as soon as the transaction confirms (default true). */
  refreshOnDone?: boolean;
}) {
  const client = useQueryClient();
  const [state, setState] = useState<FlowStep>({ step: "idle" });
  const fail = (error: unknown) =>
    setState({
      step: "error",
      message: error instanceof Error ? error.message : "Something went wrong.",
    });
  const prepare = useMutation({
    mutationFn: async (run: () => Promise<PreparedTransaction>) => {
      setState({ step: "preparing" });
      const prepared = await run();
      setState({ step: "review", prepared });
      return prepared;
    },
    onError: fail,
  });
  const confirm = useMutation({
    mutationFn: async (prepared: PreparedTransaction) => {
      assertSignerCluster(options.signer, options.cluster);
      setState({ step: "signing", prepared });
      const [signed] = await options.signer!.signTransactions(
        [prepared.transaction],
        0,
      );
      if (!signed) throw new Error("The wallet did not sign the transaction.");
      setState({ step: "submitting", prepared });
      const result = await investApi.submit(prepared.authorization, signed);
      setState({ step: "done", result });
      if (options.refreshOnDone !== false)
        await client.invalidateQueries({ queryKey: ["invest", "plans"] });
      return result;
    },
    onError: fail,
  });
  return {
    state,
    start: (run: () => Promise<PreparedTransaction>) => prepare.mutate(run),
    confirm: (prepared: PreparedTransaction) => confirm.mutate(prepared),
    reset: () => setState({ step: "idle" }),
    refresh: () => client.invalidateQueries({ queryKey: ["invest", "plans"] }),
    busy: prepare.isPending || confirm.isPending,
  };
}

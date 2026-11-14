"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Signer } from "../wallet/context";
import { creatorApi } from "./api";
import {
  archiveBasketFlow,
  type FlowStep,
  publishBasketFlow,
} from "./publish-flow";
import type { BasketDraftInput, CreatorProfile } from "./schema";

/**
 * TanStack Query v5 state for the creator flows (M5b B2). No optimistic updates: the UI moves
 * through explicit steps (challenge → signing → submitting) and shows "published" or "archived"
 * only after the server answers. Mutations are never retried automatically: each attempt needs a
 * fresh wallet signature, and the user must see what happened.
 */
export const creatorKeys = {
  isCreator: (wallet: string) => ["creators", "is-creator", wallet] as const,
};

export function useIsCreator(wallet: string | null) {
  return useQuery({
    queryKey: creatorKeys.isCreator(wallet ?? "none"),
    queryFn: () => creatorApi.isCreator(wallet!),
    enabled: Boolean(wallet),
    staleTime: 60_000,
    retry: 1,
  });
}

export type PublishInput = {
  basket: BasketDraftInput;
  basketId?: string;
  invite?: { code: string; profile: CreatorProfile };
};

export function usePublishMutation(signer: Signer | null) {
  const client = useQueryClient();
  const [step, setStep] = useState<FlowStep>({ step: "idle" });
  const mutation = useMutation({
    mutationFn: (input: PublishInput) =>
      publishBasketFlow(
        {
          api: creatorApi,
          wallet: signer!.address,
          signMessage: signer?.signMessage ?? null,
          onStep: setStep,
        },
        input,
      ),
    retry: false,
    onSettled: (_data, _error, input) => {
      if (input.invite && signer)
        void client.invalidateQueries({
          queryKey: creatorKeys.isCreator(signer.address),
        });
    },
  });
  return { ...mutation, step };
}

export function useArchiveMutation(signer: Signer | null) {
  const [step, setStep] = useState<FlowStep>({ step: "idle" });
  const mutation = useMutation({
    mutationFn: (basketId: string) =>
      archiveBasketFlow(
        {
          api: creatorApi,
          wallet: signer!.address,
          signMessage: signer?.signMessage ?? null,
          onStep: setStep,
        },
        basketId,
      ),
    retry: false,
  });
  return { ...mutation, step };
}

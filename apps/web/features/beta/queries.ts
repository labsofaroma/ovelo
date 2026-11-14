"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Signer } from "../wallet/context";
import { betaApi } from "./api";

/** TanStack Query state for the private-beta gate (REWRITE-PLAN §7.3 W2). */
export const betaKeys = {
  status: (wallet: string | null) =>
    ["beta", "status", wallet ?? "none"] as const,
};

export function useBetaStatus(wallet: string | null, enabled = true) {
  return useQuery({
    queryKey: betaKeys.status(wallet),
    queryFn: () => betaApi.status(wallet),
    enabled,
    staleTime: 60_000,
    retry: 1,
  });
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Challenge → the wallet signs the exact message → redeem. Never touches a key (rule 1). */
export function useRedeemBeta(signer: Signer | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (code: string) => {
      if (!signer?.signMessage)
        throw new Error("This wallet cannot sign messages.");
      const trimmed = code.trim();
      const challenge = await betaApi.challenge(signer.address, trimmed);
      const signature = await signer.signMessage(
        new TextEncoder().encode(challenge.message),
      );
      return betaApi.redeem({
        wallet: signer.address,
        code: trimmed,
        nonce: challenge.nonce,
        signature: toBase64(signature),
      });
    },
    retry: false,
    onSettled: () =>
      client.invalidateQueries({
        queryKey: betaKeys.status(signer?.address ?? null),
      }),
  });
}

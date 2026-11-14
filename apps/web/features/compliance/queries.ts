"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { Signer } from "../wallet/context";
import { complianceApi } from "./api";

/** TanStack Query state for the compliance gate (M9). */
export const complianceKeys = {
  status: (wallet: string | null) =>
    ["compliance", "status", wallet ?? "none"] as const,
};

export function useComplianceStatus(wallet: string | null, enabled = true) {
  return useQuery({
    queryKey: complianceKeys.status(wallet),
    queryFn: () => complianceApi.status(wallet),
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

/** Challenge → the wallet signs the exact message → accept. Never touches a key (rule 1). */
export function useAcceptTerms(signer: Signer | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!signer?.signMessage)
        throw new Error("This wallet cannot sign messages.");
      const challenge = await complianceApi.challenge(signer.address);
      const signature = await signer.signMessage(
        new TextEncoder().encode(challenge.message),
      );
      await complianceApi.accept({
        wallet: signer.address,
        nonce: challenge.nonce,
        signature: toBase64(signature),
        version: challenge.version,
      });
    },
    retry: false,
    onSettled: () =>
      client.invalidateQueries({
        queryKey: complianceKeys.status(signer?.address ?? null),
      }),
  });
}

/** After a quote is refused by the gate, re-read the status so the ticket shows why. */
export function useComplianceRefresh(errorCode: string | null) {
  const client = useQueryClient();
  useEffect(() => {
    if (
      errorCode === "TERMS_REQUIRED" ||
      errorCode === "JURISDICTION_RESTRICTED"
    )
      void client.invalidateQueries({ queryKey: ["compliance"] });
  }, [client, errorCode]);
}

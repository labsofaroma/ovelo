"use client";

import { useState } from "react";
import { call, post } from "../compliance/api";
import type { Signer } from "../wallet/context";
import { pnlCopy } from "./copy";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Sign once (read-only session, scope `portfolio`), then download the CSV for this wallet. */
export function useCsvExport(signer: Signer | null) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    if (!signer?.signMessage) return;
    setBusy(true);
    setError(null);
    try {
      const challenge = await call(
        "/api/v1/session/challenge",
        (b) => b as { nonce: string; message: string },
        post({ scope: "portfolio", wallet: signer.address }),
      );
      const signature = toBase64(
        await signer.signMessage(new TextEncoder().encode(challenge.message)),
      );
      const session = await call(
        "/api/v1/session",
        (b) => b as { token: string },
        post({
          scope: "portfolio",
          wallet: signer.address,
          nonce: challenge.nonce,
          signature,
        }),
      );
      const response = await fetch("/api/v1/portfolio/export", {
        headers: { Authorization: `Bearer ${session.token}` },
        cache: "no-store",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(body?.message ?? pnlCopy.exportFailed);
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `ovelo-${signer.address.slice(0, 8)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : pnlCopy.exportFailed);
    } finally {
      setBusy(false);
    }
  };
  return { run, busy, error, available: Boolean(signer?.signMessage) };
}

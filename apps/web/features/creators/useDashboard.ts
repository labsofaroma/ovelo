"use client";

import { useState } from "react";
import { call, post } from "../compliance/api";
import type { Signer } from "../wallet/context";
import type { DashboardData } from "./dashboard-schema";
import { dashboardSchema } from "./dashboard-schema";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Sign once (scope `creator`, 15 minutes, in memory only), then read the dashboard. */
export function useDashboard(signer: Signer | null) {
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  const load = async (bearer: string) => {
    const response = await fetch("/api/v1/creators/dashboard", {
      headers: { Authorization: `Bearer ${bearer}` },
      cache: "no-store",
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const e = body as { code?: string; message?: string } | null;
      throw {
        code: e?.code ?? "INTERNAL",
        message: e?.message ?? "The dashboard could not be loaded.",
      };
    }
    setData(dashboardSchema.parse(body));
  };

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (cause) {
      const e = cause as { code?: string; message?: string };
      if (e.code === "UNAUTHORIZED") setToken(null);
      setError({
        code: e.code ?? "INTERNAL",
        message: e.message ?? "Something went wrong.",
      });
    } finally {
      setBusy(false);
    }
  };

  const open = () =>
    run(async () => {
      if (!signer?.signMessage) return;
      const challenge = await call(
        "/api/v1/session/challenge",
        (b) => b as { nonce: string; message: string },
        post({ scope: "creator", wallet: signer.address }),
      );
      const signature = toBase64(
        await signer.signMessage(new TextEncoder().encode(challenge.message)),
      );
      const session = await call(
        "/api/v1/session",
        (b) => b as { token: string },
        post({
          scope: "creator",
          wallet: signer.address,
          nonce: challenge.nonce,
          signature,
        }),
      );
      setToken(session.token);
      await load(session.token);
    });

  const refresh = () =>
    run(async () => {
      if (token) await load(token);
    });
  return { data, error, busy, open, refresh, signedIn: token !== null };
}

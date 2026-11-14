import "server-only";
import { randomInt } from "node:crypto";
import {
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
} from "@solana/web3.js";
import { BASKET_MAX_TRANSACTIONS } from "@/lib/sdk/baskets/transaction-limits";
import { AppError } from "@/server/errors";
import { assertMainnet, type MainnetRpc } from "./rpc";

/**
 * Jito bundles for multi-transaction baskets (ported from the prototype's jito-bundles.ts). Bundles are
 * used only when JITO_BLOCK_ENGINE_URL is configured. A rejected or uncertain bundle is NEVER
 * retried as individual transactions (that would be a partial basket). Status comes from chain
 * signatures; a Jito "landed" or a bundle id alone is never reported as confirmed.
 */

const TIP_FLOOR = "https://bundles.jito.wtf/api/v1/bundles/tip_floor";
export const JITO_TIP_ACCOUNTS = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
] as const;

export type JitoRpc = <T>(method: string, params?: unknown[]) => Promise<T>;

export function jitoEndpoint(): string | null {
  return process.env.JITO_BLOCK_ENGINE_URL?.trim() || null;
}

export function createJitoRpc(endpoint: string): JitoRpc {
  return async <T>(method: string, params: unknown[] = []): Promise<T> => {
    const response = await fetch(endpoint, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
      headers: {
        "Content-Type": "application/json",
        ...(process.env.JITO_AUTH_UUID
          ? { "x-jito-auth": process.env.JITO_AUTH_UUID }
          : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      result?: T;
      error?: unknown;
    };
    if (body.error)
      throw new AppError("UPSTREAM_UNAVAILABLE", {
        detail: "Jito rejected the bundle request",
      });
    if (!response.ok || body.result === undefined)
      throw new AppError("UPSTREAM_UNAVAILABLE", {
        detail: "Jito did not provide a result",
      });
    return body.result;
  };
}

export function selectJitoTipLamports(
  floorSol: unknown,
  configuredCap = 100_000,
): number {
  if (
    !Number.isSafeInteger(configuredCap) ||
    configuredCap < 1000 ||
    configuredCap > 100_000
  )
    throw new Error("JITO_MAX_TIP_LAMPORTS must be between 1,000 and 100,000.");
  const dynamic =
    typeof floorSol === "number" && Number.isFinite(floorSol) && floorSol > 0
      ? Math.ceil(floorSol * 1_000_000_000)
      : 10_000;
  return Math.min(configuredCap, Math.max(1000, dynamic));
}

let tipCache: { until: number; accounts: string[]; floor: unknown } | undefined;

export async function prepareJitoTip(
  taker: string,
  jito: JitoRpc,
): Promise<{ lamports: number; instruction: TransactionInstruction }> {
  if (!tipCache || tipCache.until <= Date.now()) {
    const [accounts, floor] = await Promise.all([
      jito<string[]>("getTipAccounts"),
      fetch(TIP_FLOOR, { cache: "no-store", signal: AbortSignal.timeout(3000) })
        .then(async (r) => (r.ok ? ((await r.json()) as unknown) : null))
        .catch(() => null),
    ]);
    if (
      !Array.isArray(accounts) ||
      !accounts.length ||
      accounts.some(
        (key) => !(JITO_TIP_ACCOUNTS as readonly string[]).includes(key),
      )
    )
      throw new AppError("UPSTREAM_UNAVAILABLE", {
        detail: "Jito tip accounts could not be verified",
      });
    const first = Array.isArray(floor)
      ? (floor[0] as Record<string, unknown> | undefined)
      : undefined;
    tipCache = {
      until: Date.now() + 30_000,
      accounts,
      floor:
        first?.ema_landed_tips_50th_percentile ??
        first?.landed_tips_50th_percentile,
    };
  }
  const lamports = selectJitoTipLamports(
    tipCache.floor,
    Number(process.env.JITO_MAX_TIP_LAMPORTS ?? 100_000),
  );
  return {
    lamports,
    instruction: SystemProgram.transfer({
      fromPubkey: new PublicKey(taker),
      toPubkey: new PublicKey(
        tipCache.accounts[randomInt(tipCache.accounts.length)]!,
      ),
      lamports,
    }),
  };
}

export async function sendJitoBundle(
  transactions: readonly string[],
  jito: JitoRpc,
): Promise<string> {
  if (transactions.length < 2 || transactions.length > BASKET_MAX_TRANSACTIONS)
    throw new AppError("BAD_REQUEST", {
      detail: "A bundle must contain two to five reviewed transactions.",
    });
  const bundleId = await jito<string>("sendBundle", [
    transactions,
    { encoding: "base64" },
  ]);
  if (typeof bundleId !== "string" || !/^[0-9a-f]{64}$/i.test(bundleId))
    throw new AppError("UPSTREAM_UNAVAILABLE", {
      detail: "Jito returned an invalid receipt",
    });
  return bundleId;
}

export type BundleReceipt = {
  signatures: string[];
  lastValidBlockHeight: number;
  bundleId: string | null;
};
export type ChainStatus = {
  status: "pending" | "confirmed" | "failed" | "unknown";
  slot: number | null;
  detail?: string;
};

/**
 * All signatures confirmed in ONE slot: confirmed. Any error or a mixed result: unknown (partial
 * execution is possible). None yet and the blockhash expired: unknown. Otherwise pending.
 */
export async function bundleStatus(
  receipt: BundleReceipt,
  deps: { rpc: MainnetRpc; jito: JitoRpc | null },
): Promise<ChainStatus> {
  await assertMainnet(deps.rpc);
  const statuses = await deps.rpc<{
    value: ({
      err: unknown;
      confirmationStatus: string | null;
      slot: number;
    } | null)[];
  }>("getSignatureStatuses", [
    receipt.signatures,
    { searchTransactionHistory: true },
  ]);
  const values = statuses.value;
  if (!Array.isArray(values) || values.length !== receipt.signatures.length)
    return { status: "unknown", slot: null, detail: "receipts unavailable" };
  const confirmed = values.filter(
    (state) =>
      state &&
      !state.err &&
      ["confirmed", "finalized"].includes(state.confirmationStatus ?? ""),
  );
  if (confirmed.length === values.length) {
    const slots = new Set(confirmed.map((state) => state!.slot));
    return slots.size === 1
      ? { status: "confirmed", slot: confirmed[0]!.slot }
      : { status: "unknown", slot: null, detail: "landed in different slots" };
  }
  if (values.some((state) => state?.err) || confirmed.length > 0)
    return { status: "unknown", slot: null, detail: "mixed results" };
  if (deps.jito && receipt.bundleId) {
    try {
      await deps.jito("getInflightBundleStatuses", [[receipt.bundleId]]);
    } catch {
      /* chain signatures remain the source of truth */
    }
  }
  const height = await deps.rpc<number>("getBlockHeight", [
    { commitment: "finalized" },
  ]);
  if (height > receipt.lastValidBlockHeight)
    return { status: "unknown", slot: null, detail: "blockhash expired" };
  return { status: "pending", slot: null };
}

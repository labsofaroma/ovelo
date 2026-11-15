import "server-only";
import { keyringFromEnv } from "@/server/auth/trade";
import { authorizeTransactions } from "@/server/auth/trade-transactions";
import type { CreatorsDb } from "@/features/creators/db";
import { getDb } from "@/server/db/client";
import { localNeonProxy } from "@/server/db/local-neon";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";
import { getRedis } from "@/server/redis";
import { createJitoRpc, jitoEndpoint, prepareJitoTip } from "./bundle";
import { fetchJupiterBuild } from "./jupiter";
import { loadVerifiedLookupTables } from "./lookup-tables";
import { localStores } from "./local";
import type { QuoteDeps } from "./quote";
import { dbReceipts } from "./receipts-db";
import {
  latestBlockhash,
  mainnetPool,
  mainnetV1Active,
  selectTransactionVersion,
  simulateTransaction,
  type MainnetRpc,
  type RpcAccount,
} from "./rpc";
import {
  memoryReceipts,
  memoryTradeStore,
  redisTradeStore,
  type ReceiptWriter,
  type TradeStore,
} from "./store";
import type { SubmitDeps } from "./submit";

/**
 * Production wiring for the trade services. Tests build their own deps; nothing here is
 * imported by them. Redis (idempotency) and Postgres (receipts) are required: without them
 * trading is unavailable, never silently non-idempotent. The ONLY exception is an E2E run on a
 * local fork (test switches + OVELO_V1_TEST_FORK_GENESIS), which uses in-process stores.
 */

const decimalsCache = new Map<string, number>();

/** Token precision from the mint account itself (offset 44), never from price metadata. */
export function mintDecimals(rpc: MainnetRpc) {
  return async (mint: string): Promise<number> => {
    const cached = decimalsCache.get(mint);
    if (cached !== undefined) return cached;
    const { value } = await rpc<{ value: RpcAccount }>("getAccountInfo", [
      mint,
      { encoding: "base64", commitment: "confirmed" },
    ]);
    const data = value ? Buffer.from(value.data[0], "base64") : null;
    if (
      !value ||
      value.executable ||
      ![
        "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
      ].includes(value.owner) ||
      !data ||
      data.length < 82 ||
      data[45] !== 1
    )
      throw new AppError("ASSET_UNAVAILABLE", {
        detail: "mint account missing, uninitialized or not an SPL token",
      });
    const decimals = data[44]!;
    decimalsCache.set(mint, decimals);
    return decimals;
  };
}

let memory: { store: TradeStore; receipts: ReceiptWriter } | null = null;

function stores(): { store: TradeStore; receipts: ReceiptWriter } {
  if (localStores()) {
    // Receipts go to the local Postgres when the E2E runs one (scripts/local-db.sh, M5b B6), so
    // creator stats read real rows; otherwise they stay in process, as in M4.
    const url = process.env.DATABASE_URL ?? "";
    memory ??= {
      store: memoryTradeStore(),
      receipts: localNeonProxy(url) ? dbReceipts(getDb()) : memoryReceipts(),
    };
    return memory;
  }
  const redis = getRedis();
  if (!redis)
    throw new AppError("TRADING_UNAVAILABLE", {
      detail: "Upstash Redis is required for trade idempotency",
    });
  return { store: redisTradeStore(redis), receipts: dbReceipts(getDb()) };
}

/** Postgres for creator baskets (quotes) and receipts. Missing or unreachable: 503, never a guess. */
export function creatorDb(): CreatorsDb {
  return getDb();
}

export function receiptsReader(): ReceiptWriter {
  return stores().receipts;
}

export function quoteDeps(): QuoteDeps {
  const keyring = keyringFromEnv();
  const jitoUrl = jitoEndpoint();
  const jito = jitoUrl ? createJitoRpc(jitoUrl) : null;
  // M9 affinity: one quote = one endpoint (blockhash, simulation, lookup tables, accounts).
  const rpc = mainnetPool().pinned();
  return {
    decimals: mintDecimals(rpc),
    rpc,
    selectVersion: (versions) => selectTransactionVersion(versions, rpc),
    latestBlockhash: () => latestBlockhash(rpc),
    simulate: (tx, addresses) => simulateTransaction(tx, addresses, rpc),
    jupiterBuild: fetchJupiterBuild,
    lookupTables: (mappings) => loadVerifiedLookupTables(mappings, rpc),
    jitoTip: async (taker) => {
      if (!jito)
        throw new AppError("BUNDLE_UNAVAILABLE", {
          detail: "order needs a bundle; JITO_BLOCK_ENGINE_URL unset",
        });
      return prepareJitoTip(taker, jito);
    },
    bundlesEnabled: jito !== null,
    authorize: async (input) => {
      const { requestId, authorization } = await authorizeTransactions(
        input,
        keyring,
      );
      return { requestId, authorization };
    },
    now: Date.now,
  };
}

export function submitDeps(): SubmitDeps {
  const jitoUrl = jitoEndpoint();
  const { store, receipts } = stores();
  if (localStores())
    logger.warn("trade submit uses in-process stores (local fork E2E)");
  // M9: preflight and the send go through one pinned endpoint; a transport failure of the send
  // may re-send the same bytes to the other one; each status poll pins its own reads.
  const pool = mainnetPool();
  const rpc = pool.pinned();
  return {
    keyring: keyringFromEnv(),
    rpc,
    store,
    receipts,
    jito: jitoUrl ? createJitoRpc(jitoUrl) : null,
    v1Active: () => mainnetV1Active(rpc),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    resend: () =>
      pool.on(rpc.endpoint() === "fallback" ? "primary" : "fallback"),
    reads: () => pool.pinned(),
  };
}

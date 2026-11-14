import "server-only";
import { keyringFromEnv } from "@/server/auth/trade";
import { authorizeTransactions } from "@/server/auth/trade-transactions";
import type { CreatorsDb } from "@/features/creators/db";
import { getDb } from "@/server/db/client";
import { testSwitchesAllowed } from "@/server/env.schema";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";
import { getRedis } from "@/server/redis";
import { createJitoRpc, jitoEndpoint, prepareJitoTip } from "./bundle";
import { fetchJupiterBuild } from "./jupiter";
import { loadVerifiedLookupTables } from "./lookup-tables";
import type { QuoteDeps } from "./quote";
import { dbReceipts } from "./receipts-db";
import {
  latestBlockhash,
  mainnetEndpoint,
  mainnetRpc,
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
 * local fork (test switches + AROMA_V1_TEST_FORK_GENESIS), which uses in-process stores.
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

function localStores(): boolean {
  return mainnetEndpoint().fork && testSwitchesAllowed(process.env);
}

let memory: { store: TradeStore; receipts: ReceiptWriter } | null = null;

function stores(): { store: TradeStore; receipts: ReceiptWriter } {
  if (localStores()) {
    memory ??= { store: memoryTradeStore(), receipts: memoryReceipts() };
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
  return {
    decimals: mintDecimals(mainnetRpc),
    rpc: mainnetRpc,
    selectVersion: (versions) => selectTransactionVersion(versions, mainnetRpc),
    latestBlockhash: () => latestBlockhash(mainnetRpc),
    simulate: (tx, addresses) => simulateTransaction(tx, addresses, mainnetRpc),
    jupiterBuild: fetchJupiterBuild,
    lookupTables: (mappings) => loadVerifiedLookupTables(mappings, mainnetRpc),
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
  return {
    keyring: keyringFromEnv(),
    rpc: mainnetRpc,
    store,
    receipts,
    jito: jitoUrl ? createJitoRpc(jitoUrl) : null,
    v1Active: () => mainnetV1Active(mainnetRpc),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

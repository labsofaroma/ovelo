import "server-only";
import type {
  AddressLookupTableAccount,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  composeBasketV0Chunks,
  type BasketSwapLeg,
  type ComposedV0Chunk,
} from "@/lib/sdk/baskets/bundle";
import {
  composeBasketV1Chunks,
  type ComposedV1Chunk,
} from "@/lib/sdk/baskets/mainnet";
import { isTransactionCapacityError } from "@/lib/sdk/baskets/transaction-limits";
import { AppError } from "@/server/errors";

/**
 * Composition (ported from composeBasketExecution in basket-order.ts). Every order first tries
 * ONE atomic transaction, whatever its asset count. Only a capacity error (bytes or accounts)
 * splits it into up to five chunks, and then a Jito tip goes in the final chunk. Validation
 * errors never change the execution route. V1 inlines account addresses; ALTs are loaded only
 * for V0.
 */

export type Chunk = {
  transaction: string;
  serializedBytes: number;
  allocationIndexes: number[];
};

export type ComposeDeps = {
  lookupTables: (
    mappings: readonly (Record<string, string[]> | null)[],
  ) => Promise<AddressLookupTableAccount[]>;
  jitoTip: (
    taker: string,
  ) => Promise<{ lamports: number; instruction: TransactionInstruction }>;
  /** Test seam: replaces the sdk V0 composer (the prototype tests forced chunking this way). */
  composeV0?: (
    params: Parameters<typeof composeBasketV0Chunks>[0],
  ) => ComposedV0Chunk[];
};

export async function composeExecution(
  input: {
    transactionVersion: 0 | 1;
    taker: string;
    lifetime: { blockhash: string; lastValidBlockHeight: number };
    legs: BasketSwapLeg[];
    routeLookupTables: readonly (Record<string, string[]> | null)[];
  },
  deps: ComposeDeps,
): Promise<{ chunks: Chunk[]; tipLamports: number }> {
  const { transactionVersion, taker, lifetime, legs } = input;
  const lookupTables =
    transactionVersion === 0
      ? await deps.lookupTables(input.routeLookupTables)
      : [];
  const composeV0 = deps.composeV0 ?? composeBasketV0Chunks;
  const compose = async (
    finalTipInstruction?: TransactionInstruction,
  ): Promise<Chunk[]> =>
    transactionVersion === 1
      ? (
          await composeBasketV1Chunks({
            payer: taker,
            blockhash: lifetime.blockhash,
            lastValidBlockHeight: lifetime.lastValidBlockHeight,
            legs,
            allowV1: true,
            finalTipInstruction,
          })
        ).map((chunk: ComposedV1Chunk) => ({
          transaction: chunk.transaction,
          serializedBytes: chunk.serializedBytes,
          allocationIndexes: chunk.allocationIndexes,
        }))
      : composeV0({
          payer: taker,
          blockhash: lifetime.blockhash,
          legs,
          lookupTables,
          finalTipInstruction,
        }).map((chunk) => ({
          transaction: chunk.transaction,
          serializedBytes: chunk.serializedBytes,
          allocationIndexes: chunk.allocationIndexes,
        }));
  let chunks: Chunk[];
  let tipLamports = 0;
  try {
    chunks = await compose();
  } catch (error) {
    if (!isTransactionCapacityError(error) || legs.length === 1)
      throw capacity(error);
    const tip = await deps.jitoTip(taker);
    tipLamports = tip.lamports;
    try {
      chunks = await compose(tip.instruction);
    } catch (retry) {
      throw capacity(retry);
    }
  }
  return { chunks, tipLamports };
}

function capacity(error: unknown): AppError {
  if (error instanceof AppError) return error;
  return new AppError("ROUTE_UNAVAILABLE", {
    publicMessage: isTransactionCapacityError(error)
      ? "This order cannot fit within five transactions at current routes. No partial order was created."
      : undefined,
    detail: error instanceof Error ? error.message : "composition failed",
    cause: error,
  });
}

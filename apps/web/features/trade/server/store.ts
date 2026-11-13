import "server-only";
import type { Redis } from "@upstash/redis";
import type { TradeReceipt } from "@/server/auth/trade";
import type { PublicError } from "@/server/errors";

/**
 * Trade records and receipts.
 * - The trade record (Redis, 7-day TTL) is the idempotency key: `claim` is SET NX on the request
 *   id, so a replayed submit returns the stored record and never broadcasts twice.
 * - Receipts are durable rows in Postgres (`receipts`, one per transaction signature) with
 *   raw-integer text amounts. Memory implementations exist for tests and local development.
 */

export type TradeStatus =
  "submitting" | "pending" | "confirmed" | "failed" | "unknown";

export type TradeRecord = {
  id: string;
  taker: string;
  mode: "single" | "bundle";
  transactionVersion: 0 | 1;
  signatures: string[];
  bundleId: string | null;
  status: TradeStatus;
  lastValidBlockHeight: number;
  receipt: TradeReceipt;
  submittedAt: string;
  updatedAt: string;
  slot: number | null;
  error: PublicError | null;
};

export interface TradeStore {
  /** Store the record only if the id is new. Returns the EXISTING record when it is not. */
  claim(record: TradeRecord): Promise<TradeRecord | null>;
  save(record: TradeRecord): Promise<void>;
  get(id: string): Promise<TradeRecord | null>;
}

export type ReceiptRow = {
  signature: string;
  wallet: string;
  kind: "spot" | "basket";
  amountIn: string;
  mintIn: string;
  legs: unknown[];
  slot: bigint | null;
  blockTime: Date | null;
  status: "pending" | "confirmed" | "failed";
  createdAt: Date;
};

export interface ReceiptWriter {
  insertPending(
    rows: Omit<ReceiptRow, "status" | "slot" | "blockTime" | "createdAt">[],
  ): Promise<void>;
  mark(
    signatures: readonly string[],
    update: {
      status: "confirmed" | "failed";
      slot: bigint | null;
      blockTime: Date | null;
    },
  ): Promise<void>;
  listByWallet(wallet: string, limit: number): Promise<ReceiptRow[]>;
}

const TTL_SECONDS = 7 * 24 * 3600;
const key = (id: string) => `v1:trade:${id}`;

export function redisTradeStore(redis: Redis): TradeStore {
  const parse = (value: unknown): TradeRecord | null =>
    typeof value === "string" ? (JSON.parse(value) as TradeRecord) : null;
  return {
    async claim(record) {
      const created = await redis.set(key(record.id), JSON.stringify(record), {
        nx: true,
        ex: TTL_SECONDS,
      });
      if (created === "OK") return null;
      return parse(await redis.get(key(record.id)));
    },
    async save(record) {
      await redis.set(key(record.id), JSON.stringify(record), {
        ex: TTL_SECONDS,
      });
    },
    async get(id) {
      return parse(await redis.get(key(id)));
    },
  };
}

export function memoryTradeStore(): TradeStore {
  const records = new Map<string, string>();
  return {
    async claim(record) {
      const existing = records.get(record.id);
      if (existing) return JSON.parse(existing) as TradeRecord;
      records.set(record.id, JSON.stringify(record));
      return null;
    },
    async save(record) {
      records.set(record.id, JSON.stringify(record));
    },
    async get(id) {
      const value = records.get(id);
      return value ? (JSON.parse(value) as TradeRecord) : null;
    },
  };
}

export function memoryReceipts(): ReceiptWriter {
  const rows = new Map<string, ReceiptRow>();
  return {
    async insertPending(items) {
      for (const item of items)
        if (!rows.has(item.signature))
          rows.set(item.signature, {
            ...item,
            status: "pending",
            slot: null,
            blockTime: null,
            createdAt: new Date(),
          });
    },
    async mark(signatures, update) {
      for (const signature of signatures) {
        const row = rows.get(signature);
        if (row && row.status === "pending")
          rows.set(signature, { ...row, ...update });
      }
    },
    async listByWallet(wallet, limit) {
      return [...rows.values()]
        .filter((row) => row.wallet === wallet)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit);
    },
  };
}

/** One receipt row per transaction: the legs it carries and their nominal input (raw units). */
export function receiptRows(
  record: Pick<TradeRecord, "signatures" | "taker" | "receipt" | "id">,
): Omit<ReceiptRow, "status" | "slot" | "blockTime" | "createdAt">[] {
  return record.signatures.map((signature, tx) => {
    const legs = record.receipt.legs.filter((leg) => leg.tx === tx);
    const amountIn = legs.reduce(
      (sum, leg) => sum + BigInt(leg.inputAmount),
      0n,
    );
    return {
      signature,
      wallet: record.taker,
      kind: record.receipt.kind,
      amountIn: amountIn.toString(),
      mintIn: record.receipt.inputMint,
      legs: legs.map((leg) => ({
        ...leg,
        requestId: record.id,
        basket: record.receipt.basketId,
      })),
    };
  });
}

import "server-only";
import { inArray } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { baskets } from "@/server/db/schema";
import { getRedis } from "@/server/redis";
import { logger } from "@/server/logger";
import type { MarketsView } from "../../markets/schema";
import type { ReceiptRow } from "../../trade/server/store";
import { mainnetRpc } from "../../trade/server/rpc";
import type { Holding } from "../schema";
import { buildPnl, type ReceiptInput } from "./build";
import { loadFills, type FillCache, type Fills } from "./fills";
import type { PnlView } from "./schema";

/**
 * Server wiring for P&L: receipts → exact fills (Redis cache for 30 days, else this process;
 * at most 20 transaction reads per request) → buildPnl. Read-only against mainnet.
 */
const memory = new Map<string, Fills>();
const FILL_TTL_SECONDS = 30 * 86_400;

function fillCache(): FillCache {
  const redis = getRedis();
  return {
    async get(signature) {
      const local = memory.get(signature);
      if (local) return local;
      if (!redis) return null;
      const value = await redis.get<Fills>(`fill:v1:${signature}`);
      if (value) memory.set(signature, value);
      return value ?? null;
    },
    async set(signature, fills) {
      if (memory.size > 5_000) memory.clear();
      memory.set(signature, fills);
      await redis?.set(`fill:v1:${signature}`, fills, { ex: FILL_TTL_SECONDS });
    },
  };
}

const readTransaction = (signature: string) =>
  mainnetRpc<unknown>("getTransaction", [
    signature,
    {
      encoding: "jsonParsed",
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    },
  ]);

export function receiptInputs(rows: readonly ReceiptRow[]): ReceiptInput[] {
  return rows.map((row) => ({
    signature: row.signature,
    kind: row.kind,
    status: row.status,
    mintIn: row.mintIn,
    createdAt: row.createdAt,
    legs: (row.legs as Record<string, unknown>[])
      .filter(
        (leg) => leg && typeof leg === "object" && typeof leg.mint === "string",
      )
      .map((leg) => ({
        mint: String(leg.mint),
        inputAmount: /^\d+$/.test(String(leg.inputAmount))
          ? String(leg.inputAmount)
          : "0",
        basket: typeof leg.basket === "string" ? leg.basket : null,
        requestId: typeof leg.requestId === "string" ? leg.requestId : null,
      })),
  }));
}

async function basketNames(refs: string[], markets: MarketsView | null) {
  const names = new Map((markets?.baskets ?? []).map((b) => [b.id, b.name]));
  const uuids = refs.filter((r) => /^[0-9a-f-]{36}$/.test(r) && !names.has(r));
  if (uuids.length)
    try {
      const rows = await getDb()
        .select({ id: baskets.id, name: baskets.name })
        .from(baskets)
        .where(inArray(baskets.id, uuids));
      for (const row of rows) names.set(row.id, row.name);
    } catch (err) {
      logger.warn({ err }, "basket names unavailable");
    }
  return (ref: string) => names.get(ref) ?? ref;
}

export async function loadPnl(
  wallet: string,
  holdings: readonly Holding[],
  rows: readonly ReceiptRow[],
  markets: MarketsView | null,
): Promise<PnlView> {
  return (await loadPnlData(wallet, holdings, rows, markets)).pnl;
}

/** P&L with the receipts and fills it was built from (the CSV export needs all three). */
export async function loadPnlData(
  wallet: string,
  holdings: readonly Holding[],
  rows: readonly ReceiptRow[],
  markets: MarketsView | null,
) {
  const receipts = receiptInputs(rows);
  const confirmed = receipts.filter(
    (r) =>
      r.status === "confirmed" && (r.kind === "spot" || r.kind === "basket"),
  );
  const fills = await loadFills(
    confirmed.map((r) => r.signature),
    wallet,
    { cache: fillCache(), read: readTransaction },
  );
  const refs = [
    ...new Set(
      confirmed.flatMap((r) =>
        r.legs.flatMap((l) => (l.basket ? [l.basket] : [])),
      ),
    ),
  ];
  const pnl = buildPnl({
    holdings,
    receipts,
    fills,
    basketName: await basketNames(refs, markets),
  });
  return { pnl, receipts, fills };
}

import "server-only";
import { getTransactionDecoder } from "@solana/kit";
import type { MainnetRpc } from "@/features/trade/server/rpc";
import { messageHash } from "@/server/auth/trade-transactions";

/**
 * What became of a Solana Action quote, for settling its W3 cap reservation. A Blink client
 * signs and sends the transaction itself, so Aroma knows no signature, only the SHA-256 of the
 * one message it authorized. Once the reservation's resolve time has passed (the quote expired
 * at least RESOLVE_MARGIN_MS ago, far past any blockhash lifetime), the wallet's own recent
 * transactions are searched for that message:
 * - found without error → confirmed (keeps counting); found with an error → failed (released);
 * - every transaction since the quote searched and none matches → failed: it can never land;
 * - too many transactions to search, one not readable yet, or any RPC error → open (keeps counting: fail closed).
 * Read-only RPC calls only.
 */
export type ActionReservation = {
  wallet: string;
  actionMessageHash: string;
  createdAt: Date;
};

/** Transactions before the reservation minus this cannot carry the quote (it was just built). */
const QUOTE_LEAD_MS = 2 * 60_000;
const PAGE = 100;
const MAX_PAGES = 3;
/** At most this many transactions are fetched and compared; more → open. */
const MAX_CANDIDATES = 40;

type SignatureInfo = { signature: string; blockTime: number | null };
type RpcTransaction = {
  meta: { err: unknown } | null;
  transaction: [string, string];
} | null;

export async function actionOutcome(
  reservation: ActionReservation,
  rpc: MainnetRpc,
): Promise<"confirmed" | "failed" | "open"> {
  const since = Math.floor(
    (reservation.createdAt.getTime() - QUOTE_LEAD_MS) / 1000,
  );
  try {
    const candidates: string[] = [];
    let before: string | undefined;
    let complete = false;
    for (let page = 0; page < MAX_PAGES && !complete; page++) {
      const batch = await rpc<SignatureInfo[]>("getSignaturesForAddress", [
        reservation.wallet,
        { limit: PAGE, commitment: "confirmed", ...(before ? { before } : {}) },
      ]);
      for (const info of batch) {
        // A missing blockTime is rare and recent; search it rather than skip it.
        if (info.blockTime !== null && info.blockTime < since) {
          complete = true;
          break;
        }
        candidates.push(info.signature);
      }
      if (batch.length < PAGE) complete = true;
      before = batch.at(-1)?.signature;
    }
    if (!complete || candidates.length > MAX_CANDIDATES) return "open";
    for (const signature of candidates) {
      const found = await rpc<RpcTransaction>("getTransaction", [
        signature,
        {
          encoding: "base64",
          commitment: "confirmed",
          maxSupportedTransactionVersion: 1,
        },
      ]);
      // Listed but not readable yet: it may be the one; decide later.
      if (!found) return "open";
      const transaction = getTransactionDecoder().decode(
        Buffer.from(found.transaction[0], "base64"),
      );
      if (
        messageHash(transaction.messageBytes) !== reservation.actionMessageHash
      )
        continue;
      return found.meta && found.meta.err === null ? "confirmed" : "failed";
    }
    return "failed";
  } catch {
    return "open";
  }
}

import "server-only";
import { VersionedTransaction } from "@solana/web3.js";

/**
 * Fees read from the transactions themselves (PRODUCT.md: no invented figures). The base fee is
 * the protocol's 5,000 lamports per signature. The priority fee is what the compute-budget
 * instructions encode: ceil(unit limit x micro-lamports per unit / 1e6). A V1 message carries
 * its budget in the header; we report it only when it can be read, else null ("not shown").
 */

const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
export const LAMPORTS_PER_SIGNATURE = 5_000n;

export function priorityFeeLamports(encoded: string): bigint | null {
  let tx: VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(Buffer.from(encoded, "base64"));
  } catch {
    return null;
  }
  const keys = tx.message.staticAccountKeys;
  let limit: bigint | null = null;
  let price: bigint | null = null;
  for (const ix of tx.message.compiledInstructions) {
    if (keys[ix.programIdIndex]?.toBase58() !== COMPUTE_BUDGET) continue;
    const data = Buffer.from(ix.data);
    if (data[0] === 2 && data.length >= 5) limit = BigInt(data.readUInt32LE(1));
    if (data[0] === 3 && data.length >= 9) price = data.readBigUInt64LE(1);
  }
  if (price === null) return 0n;
  if (limit === null) return null;
  return (limit * price + 999_999n) / 1_000_000n;
}

export function feeSummary(
  transactions: readonly string[],
  tipLamports: number,
): {
  baseFeeLamports: string;
  priorityFeeLamports: string | null;
  tipLamports: string;
  platformFeeBps: 0;
} {
  let priority: bigint | null = 0n;
  for (const tx of transactions) {
    const fee = priorityFeeLamports(tx);
    priority = fee === null || priority === null ? null : priority + fee;
  }
  return {
    baseFeeLamports: (
      LAMPORTS_PER_SIGNATURE * BigInt(transactions.length)
    ).toString(),
    priorityFeeLamports: priority === null ? null : priority.toString(),
    tipLamports: String(tipLamports),
    platformFeeBps: 0,
  };
}

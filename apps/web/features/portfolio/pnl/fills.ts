import { z } from "zod";

/**
 * What a confirmed purchase actually delivered (M11 Step 2). Receipts store the QUOTED output;
 * the exact fill is the wallet's token-balance change in the confirmed transaction
 * (`meta.postTokenBalances − meta.preTokenBalances`, owner = the wallet), read once from mainnet
 * RPC (read-only) and cached: a confirmed transaction never changes.
 */
const balanceSchema = z.object({
  mint: z.string(),
  owner: z.string().optional(),
  uiTokenAmount: z.object({ amount: z.string().regex(/^\d+$/) }),
});
const transactionSchema = z
  .object({
    meta: z
      .object({
        err: z.unknown().nullable(),
        preTokenBalances: z.array(balanceSchema).nullable().optional(),
        postTokenBalances: z.array(balanceSchema).nullable().optional(),
      })
      .nullable(),
  })
  .nullable();

/** mint → raw units received by `wallet` (only positive changes; a failed tx gives nothing). */
export type Fills = Record<string, string>;

export function fillsFromTransaction(
  raw: unknown,
  wallet: string,
): Fills | null {
  const parsed = transactionSchema.safeParse(raw);
  if (!parsed.success || !parsed.data?.meta) return null;
  const { meta } = parsed.data;
  if (meta.err !== null && meta.err !== undefined) return {};
  const sum = (list: z.infer<typeof balanceSchema>[] | null | undefined) => {
    const out = new Map<string, bigint>();
    for (const b of list ?? [])
      if (b.owner === wallet)
        out.set(
          b.mint,
          (out.get(b.mint) ?? 0n) + BigInt(b.uiTokenAmount.amount),
        );
    return out;
  };
  const pre = sum(meta.preTokenBalances);
  const post = sum(meta.postTokenBalances);
  const fills: Fills = {};
  for (const [mint, after] of post) {
    const delta = after - (pre.get(mint) ?? 0n);
    if (delta > 0n) fills[mint] = delta.toString();
  }
  return fills;
}

export type FillCache = {
  get(signature: string): Promise<Fills | null>;
  set(signature: string, fills: Fills): Promise<void>;
};

export type ReadTransaction = (signature: string) => Promise<unknown>;

/**
 * Fills for confirmed signatures: from the cache, else read from RPC, at most `maxReads` per
 * call (bounded). A signature not read yet is simply absent: its mints are "fill not read yet",
 * never an estimate.
 */
export async function loadFills(
  signatures: readonly string[],
  wallet: string,
  deps: { cache: FillCache; read: ReadTransaction; maxReads?: number },
): Promise<Map<string, Fills>> {
  const out = new Map<string, Fills>();
  let reads = 0;
  for (const signature of signatures) {
    const cached = await deps.cache.get(signature).catch(() => null);
    if (cached) {
      out.set(signature, cached);
      continue;
    }
    if (reads >= (deps.maxReads ?? 20)) continue;
    reads += 1;
    const tx = await deps.read(signature).catch(() => null);
    const fills = fillsFromTransaction(tx, wallet);
    if (fills) {
      out.set(signature, fills);
      await deps.cache.set(signature, fills).catch(() => undefined);
    }
  }
  return out;
}

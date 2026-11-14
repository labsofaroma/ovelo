/**
 * Fully verified Pyth price updates for the keeper: the Wormhole bridge verifies the VAA in an
 * encoded-VAA account, then the receiver posts one `PriceUpdateV2` per feed from it
 * (VerificationLevel::Full). Instruction groups are packed by measuring the real wire size
 * with kit's encoder, with room for two compute-budget instructions in every transaction.
 */
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import {
  parseAccumulatorUpdate,
  parseVaa,
  type AccumulatorUpdate,
} from "./accumulator";
import {
  closeEncodedVaaInstruction,
  createEncodedVaaAccountInstruction,
  findGuardianSetPda,
  initEncodedVaaInstruction,
  verifyEncodedVaaV1Instruction,
  writeEncodedVaaInstruction,
} from "./wormhole";
import { postUpdateInstruction, reclaimRentInstruction } from "./receiver";

/** Solana's packet limit for one serialized transaction. */
export const TRANSACTION_SIZE_LIMIT = 1232;
const COMPUTE_BUDGET_ID = address(
  "ComputeBudget111111111111111111111111111111",
);
const PLACEHOLDER_BLOCKHASH = "11111111111111111111111111111111" as Blockhash;

/** SetComputeUnitLimit and SetComputeUnitPrice, as the keeper adds them. */
export function computeBudgetInstructions(
  units: number,
  microLamports: bigint,
): Instruction[] {
  const limit = new Uint8Array(5);
  limit[0] = 2;
  new DataView(limit.buffer).setUint32(1, units, true);
  const price = new Uint8Array(9);
  price[0] = 3;
  new DataView(price.buffer).setBigUint64(1, microLamports, true);
  return [
    { programAddress: COMPUTE_BUDGET_ID, data: limit },
    { programAddress: COMPUTE_BUDGET_ID, data: price },
  ];
}

/** Serialized size of a v0 transaction with these instructions (signatures included). */
export function transactionSize(
  feePayer: TransactionSigner,
  instructions: readonly Instruction[],
): number {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: PLACEHOLDER_BLOCKHASH, lastValidBlockHeight: 0n },
        m,
      ),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  return getTransactionEncoder().encode(compileTransaction(message)).length;
}

const RESERVE = computeBudgetInstructions(1_400_000, 1n);
const fits = (payer: TransactionSigner, ixs: readonly Instruction[]) =>
  transactionSize(payer, [...RESERVE, ...ixs]) <= TRANSACTION_SIZE_LIMIT;

export type VerifiedPriceUpdates = {
  /** Ordered transactions (instructions without compute budget) that verify the VAA. */
  prepare: Instruction[][];
  /** One `post_update` per feed, in the accumulator's order. */
  post: Instruction[];
  /** `close_encoded_vaa` and one `reclaim_rent` per price update (rent to the write authority). */
  cleanup: Instruction[];
  priceUpdates: { feedId: string; address: Address; publishTime: bigint }[];
  guardianSetIndex: number;
};

export async function buildVerifiedPriceUpdates(params: {
  payer: TransactionSigner;
  writeAuthority: TransactionSigner;
  accumulator: Uint8Array | AccumulatorUpdate;
  encodedVaa: TransactionSigner;
  /** Rent-exempt lamports for `encodedVaaSpace(vaa.length)`, read from the RPC. */
  encodedVaaLamports: bigint;
  /**
   * One per feed, in the accumulator's order: a fresh keypair (created by the post, rent
   * reclaimed in `cleanup`) or the address of a price update account this write authority
   * already owns (overwritten in place: no signature, no rent, no reclaim).
   */
  priceUpdateSigners: readonly (TransactionSigner | Address)[];
  treasuryId: number;
  /** Optional cap on bytes per write instruction (the packer already fills transactions). */
  chunkBytes?: number;
}): Promise<VerifiedPriceUpdates> {
  const update =
    params.accumulator instanceof Uint8Array
      ? parseAccumulatorUpdate(params.accumulator)
      : params.accumulator;
  if (params.priceUpdateSigners.length !== update.updates.length)
    throw new Error("One price update signer per feed in the update.");
  const vaa = parseVaa(update.vaa);
  const { payer, writeAuthority, encodedVaa } = params;
  const target = encodedVaa.address;
  const prepare: Instruction[][] = [];
  let group: Instruction[] = [
    createEncodedVaaAccountInstruction({
      payer,
      encodedVaa,
      vaaLength: update.vaa.length,
      lamports: params.encodedVaaLamports,
    }),
    initEncodedVaaInstruction({ writeAuthority, encodedVaa: target }),
  ];
  const write = (index: number, data: Uint8Array) =>
    writeEncodedVaaInstruction({
      writeAuthority,
      encodedVaa: target,
      index,
      data,
    });
  // Measured with a 200-byte probe so the instruction-data length prefix is its 2-byte form.
  const PROBE = 200;
  let written = 0;
  while (written < update.vaa.length) {
    const base =
      transactionSize(payer, [
        ...RESERVE,
        ...group,
        write(written, new Uint8Array(PROBE)),
      ]) - PROBE;
    const room = Math.min(
      TRANSACTION_SIZE_LIMIT - base,
      params.chunkBytes ?? Number.MAX_SAFE_INTEGER,
      update.vaa.length - written,
    );
    if (room < 1) {
      if (group.length === 0)
        throw new Error("A write cannot fit a transaction.");
      prepare.push(group);
      group = [];
      continue;
    }
    group.push(write(written, update.vaa.slice(written, written + room)));
    written += room;
  }
  const verify = verifyEncodedVaaV1Instruction({
    writeAuthority,
    encodedVaa: target,
    guardianSet: await findGuardianSetPda(vaa.guardianSetIndex),
  });
  if (fits(payer, [...group, verify])) group.push(verify);
  else {
    prepare.push(group);
    group = [verify];
  }
  prepare.push(group);

  const post = await Promise.all(
    update.updates.map((u, i) =>
      postUpdateInstruction({
        payer,
        writeAuthority,
        encodedVaa: target,
        priceUpdate: params.priceUpdateSigners[i]!,
        message: u.message,
        proof: u.proof,
        treasuryId: params.treasuryId,
      }),
    ),
  );
  const addressOf = (s: TransactionSigner | Address): Address =>
    typeof s === "string" ? s : s.address;
  const cleanup = [
    closeEncodedVaaInstruction({ writeAuthority, encodedVaa: target }),
    ...params.priceUpdateSigners
      .filter((s): s is TransactionSigner => typeof s !== "string")
      .map((s) =>
        reclaimRentInstruction({
          payer: writeAuthority,
          priceUpdate: s.address,
        }),
      ),
  ];
  return {
    prepare,
    post,
    cleanup,
    priceUpdates: update.updates.map((u, i) => ({
      feedId: u.feed.feedId,
      address: addressOf(params.priceUpdateSigners[i]!),
      publishTime: u.feed.publishTime,
    })),
    guardianSetIndex: vaa.guardianSetIndex,
  };
}

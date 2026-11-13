import { createPrivateKey, sign } from "node:crypto";
import * as kit from "@solana/kit";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  composeV1Transaction,
  inspectWalletTransaction,
} from "@/lib/sdk/baskets/mainnet";

/**
 * TEST-ONLY transaction fixtures. Keypairs come from fixed seeds and exist only in test code; they
 * hold nothing and never touch a network.
 */
export const testKeypair = (seed: number): Keypair =>
  Keypair.fromSeed(new Uint8Array(32).fill(seed));

export const signer = testKeypair(1);
export const otherSigner = testKeypair(9);
export const recipient = testKeypair(2).publicKey;
export const blockhash = testKeypair(3).publicKey.toBase58();

/** A v0 transfer, optionally signed by `by` (web3.js signing, as the prototype tests did). */
export function v0Transfer(
  lamports: number,
  options: { signed?: boolean; by?: Keypair; recentBlockhash?: string } = {},
): string {
  const by = options.by ?? signer;
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: by.publicKey,
      recentBlockhash: options.recentBlockhash ?? blockhash,
      instructions: [
        SystemProgram.transfer({
          fromPubkey: by.publicKey,
          toPubkey: recipient,
          lamports,
        }),
      ],
    }).compileToV0Message(),
  );
  if (options.signed) tx.sign([by]);
  return Buffer.from(tx.serialize()).toString("base64");
}

/** Sign an encoded (kit-decodable) transaction with Ed25519 over its message bytes. */
export async function signEncoded(
  encoded: string,
  by: Keypair = signer,
): Promise<string> {
  const { transaction } = await inspectWalletTransaction(encoded);
  const key = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      Buffer.from(by.secretKey.subarray(0, 32)),
    ]),
    type: "pkcs8",
    format: "der",
  });
  const signature = sign(null, Buffer.from(transaction.messageBytes), key);
  return Buffer.from(
    kit.getTransactionEncoder().encode({
      ...transaction,
      signatures: {
        ...transaction.signatures,
        [kit.address(by.publicKey.toBase58())]:
          signature as unknown as kit.SignatureBytes,
      },
    }),
  ).toString("base64");
}

/** A v1 transfer (optionally padded with a memo to exceed the legacy 1232-byte limit). */
export async function v1Transfer(
  lamports: number,
  memoBytes = 0,
): Promise<string> {
  const built = await composeV1Transaction({
    payer: signer.publicKey.toBase58(),
    blockhash,
    lastValidBlockHeight: 100,
    allowV1: true,
    instructions: [
      SystemProgram.transfer({
        fromPubkey: signer.publicKey,
        toPubkey: recipient,
        lamports,
      }),
      ...(memoBytes
        ? [
            new TransactionInstruction({
              programId: new PublicKey(
                "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
              ),
              keys: [],
              data: Buffer.alloc(memoBytes, 65),
            }),
          ]
        : []),
    ],
  });
  return built.transaction;
}

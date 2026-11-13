import * as spl from "@solana/spl-token";
import * as web3 from "@solana/web3.js";
import type { RpcAccount } from "./rpc";

/** TEST-ONLY account and instruction fixtures for the ported quote suite. */
export type ApiInstruction = {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string;
};

export const key = () => web3.Keypair.generate().publicKey.toBase58();
export const wallet = key();
export const inputMint = key();
export const intermediateMint = key();
export const outputMints = [key(), key()] as const;

export const ata = (mint: string, tokenProgram = spl.TOKEN_PROGRAM_ID) =>
  spl
    .getAssociatedTokenAddressSync(
      new web3.PublicKey(mint),
      new web3.PublicKey(wallet),
      false,
      tokenProgram,
    )
    .toBase58();

export function tokenAccount(
  mint: string,
  amount: number,
  tokenProgram = spl.TOKEN_PROGRAM_ID,
): NonNullable<RpcAccount> {
  const data = Buffer.alloc(165);
  new web3.PublicKey(mint).toBuffer().copy(data, 0);
  new web3.PublicKey(wallet).toBuffer().copy(data, 32);
  data.writeBigUInt64LE(BigInt(amount), 64);
  data[108] = 1;
  return {
    owner: tokenProgram.toBase58(),
    data: [data.toString("base64"), "base64"],
    lamports: 2039280,
    executable: false,
  };
}

export function mintAccount(
  tokenProgram = spl.TOKEN_PROGRAM_ID,
): NonNullable<RpcAccount> {
  const data = Buffer.alloc(82);
  data[44] = 6;
  data[45] = 1;
  return {
    owner: tokenProgram.toBase58(),
    data: [data.toString("base64"), "base64"],
    lamports: 1461600,
    executable: false,
  };
}

export function apiInstruction(
  instruction: web3.TransactionInstruction,
): ApiInstruction {
  return {
    programId: instruction.programId.toBase58(),
    accounts: instruction.keys.map(({ pubkey, isSigner, isWritable }) => ({
      pubkey: pubkey.toBase58(),
      isSigner,
      isWritable,
    })),
    data: instruction.data.toString("base64"),
  };
}

export function createAta(
  mint: string,
  tokenProgram: web3.PublicKey,
): ApiInstruction {
  return apiInstruction(
    spl.createAssociatedTokenAccountIdempotentInstruction(
      new web3.PublicKey(wallet),
      new web3.PublicKey(ata(mint, tokenProgram)),
      new web3.PublicKey(wallet),
      new web3.PublicKey(mint),
      tokenProgram,
    ),
  );
}

/**
 * The swap authority's token accounts: one for the funding mint and one transit account per
 * output mint, created once (idempotently) by whoever pays, usually the keeper. They hold
 * nothing at rest; the program requires each to end every leg at the balance it started with.
 */
import {
  AccountRole,
  type Address,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import { ASSOCIATED_TOKEN_PROGRAM_ID, SYSTEM_PROGRAM_ID } from "../constants";
import { findAssociatedTokenAddress } from "../pdas";
import { findSwapAuthorityPda } from "./pdas";

/** `CreateIdempotent` (ATA instruction 1) for `owner`'s account of `mint`. */
export async function createAtaIdempotentInstruction(
  payer: TransactionSigner,
  owner: Address,
  mint: Address,
  tokenProgram: Address,
): Promise<Instruction> {
  return {
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ID,
    accounts: [
      {
        address: payer.address,
        role: AccountRole.WRITABLE_SIGNER,
        signer: payer,
      },
      {
        address: await findAssociatedTokenAddress(owner, mint, tokenProgram),
        role: AccountRole.WRITABLE,
      },
      { address: owner, role: AccountRole.READONLY },
      { address: mint, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
      { address: tokenProgram, role: AccountRole.READONLY },
    ],
    data: new Uint8Array([1]),
  } as Instruction;
}

export async function swapAuthorityAccountInstructions(
  payer: TransactionSigner,
  accounts: readonly { mint: Address; tokenProgram: Address }[],
): Promise<Instruction[]> {
  const authority = await findSwapAuthorityPda();
  const seen = new Set<string>();
  const out: Instruction[] = [];
  for (const a of accounts) {
    if (seen.has(a.mint)) continue;
    seen.add(a.mint);
    out.push(
      await createAtaIdempotentInstruction(
        payer,
        authority,
        a.mint,
        a.tokenProgram,
      ),
    );
  }
  return out;
}

/** The swap authority and its token accounts (mainnet build). */
import {
  getProgramDerivedAddress,
  getUtf8Encoder,
  type Address,
} from "@solana/kit";
import { OVELO_GUARD_V1_PROGRAM_ID } from "../constants";
import { findAssociatedTokenAddress } from "../pdas";
import { SWAP_AUTHORITY_SEED } from "./constants";

/** Program-wide signer of every Jupiter CPI. */
export async function findSwapAuthorityPda(
  program: Address = OVELO_GUARD_V1_PROGRAM_ID,
): Promise<Address> {
  const [found] = await getProgramDerivedAddress({
    programAddress: program,
    seeds: [Uint8Array.from(getUtf8Encoder().encode(SWAP_AUTHORITY_SEED))],
  });
  return found;
}

export type SwapAccounts = {
  authority: Address;
  /** The authority's funding-mint ATA (route source). */
  source: Address;
  /** The authority's output-mint ATA (route transit). */
  transit: Address;
};

/** The three swap-authority addresses one leg's route must use. */
export async function swapAccountsFor(p: {
  fundingMint: Address;
  fundingTokenProgram: Address;
  outputMint: Address;
  outputTokenProgram: Address;
  program?: Address;
}): Promise<SwapAccounts> {
  const authority = await findSwapAuthorityPda(p.program);
  return {
    authority,
    source: await findAssociatedTokenAddress(
      authority,
      p.fundingMint,
      p.fundingTokenProgram,
    ),
    transit: await findAssociatedTokenAddress(
      authority,
      p.outputMint,
      p.outputTokenProgram,
    ),
  };
}

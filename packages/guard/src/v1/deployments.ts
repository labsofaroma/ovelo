/**
 * Where Aroma Guard v1 is deployed. Filled in from the owner's deploy output
 * (docs/M6-DEVNET-DEPLOY.md, "What to paste back"); `null` means not deployed there yet. The
 * web app must not offer a v1 flow on a cluster whose entry is null.
 */
import type { Address } from "@solana/kit";
import { AROMA_GUARD_V1_PROGRAM_ID } from "./constants";

export type V1Deployment = {
  cluster: "devnet" | "mainnet";
  genesisHash: string;
  programId: Address;
  /** Signature of the deploy transaction, for the record. */
  deploySignature: string;
  /** Test USD (devnet) or USDC (mainnet). */
  fundingMint: Address;
};

export const DEVNET_GENESIS_HASH =
  "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const MAINNET_GENESIS_HASH =
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

/** Pending the owner's devnet deploy (M6). The program ID is fixed by the program keypair. */
export const V1_DEPLOYMENTS: Record<"devnet" | "mainnet", V1Deployment | null> =
  {
    devnet: null,
    mainnet: null,
  };

/** The expected v1 program ID for every cluster (one keypair, one ID). */
export const V1_PROGRAM_ID: Address = AROMA_GUARD_V1_PROGRAM_ID;

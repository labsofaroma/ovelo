/** Ovelo Guard v1 program and the programs it integrates with. */
import { address, type Address } from "@solana/kit";
import { OVELO_GUARD_PROGRAM_ADDRESS } from "./generated";

/** The v1 program ID (from the IDL; the owner's program keypair defines it). */
export const OVELO_GUARD_V1_PROGRAM_ID: Address = OVELO_GUARD_PROGRAM_ADDRESS;
/** Solana Foundation Subscriptions (layout pinned at upstream `program-v0.5.0`). */
export const SUBSCRIPTIONS_PROGRAM_ID = address(
  "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44",
);
export const PYTH_RECEIVER_PROGRAM_ID = address(
  "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ",
);
export const TOKEN_PROGRAM_ID = address(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
export const TOKEN_2022_PROGRAM_ID = address(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
);
export const ASSOCIATED_TOKEN_PROGRAM_ID = address(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);
export const BPF_LOADER_UPGRADEABLE_ID = address(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);
export const SYSTEM_PROGRAM_ID = address("11111111111111111111111111111111");

/** Must match `packages/contracts/programs/ovelo_guard/src/constants.rs`. */
export const MAX_OUTPUTS = 20;
export const TOTAL_WEIGHT_BPS = 10_000;
export const NO_PERIOD = 0xffff;
export const ACCOUNTS_PER_LEG = 6;
/**
 * Legs per `execute_installment` transaction without an address lookup table. Each leg adds
 * 6 accounts (5 unique); 3 legs keep the transaction under the 1,232-byte limit with room for
 * a compute-budget instruction and price posts in a previous transaction.
 */
export const MAX_LEGS_PER_TRANSACTION = 3;

/**
 * Mainnet (default build) execution constants. Each must match the Rust program:
 * `integrations/jupiter.rs` and `constants.rs` in `packages/contracts/programs/aroma_guard`.
 */
import { address } from "@solana/kit";

/** Jupiter Aggregator v6. */
export const JUPITER_V6_PROGRAM_ID = address(
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
);
/** Jupiter's Anchor event-authority PDA. */
export const JUPITER_EVENT_AUTHORITY = address(
  "D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf",
);
/** `sha256("global:route_v2")[..8]`; the only Jupiter instruction the program forwards. */
export const ROUTE_V2_DISCRIMINATOR = Object.freeze([
  187, 100, 250, 204, 49, 196, 175, 20,
]);
/** `route_v2` fixed account positions (pinned Jupiter IDL). */
export const ROUTE_V2 = Object.freeze({
  authority: 0,
  source: 1,
  transit: 2,
  sourceMint: 3,
  destinationMint: 4,
  sourceTokenProgram: 5,
  destinationTokenProgram: 6,
  destination: 7,
  eventAuthority: 8,
  program: 9,
  prefixLength: 10,
});
/** Discriminator, two u64, three u16 and the route vector's u32 length. */
export const ROUTE_V2_HEAD_LENGTH = 34;
export const MAX_ROUTE_DATA_LENGTH = 1_024;
/** `[asset, price_update]` before each leg's route accounts. */
export const ROUTED_FIXED_ACCOUNTS_PER_LEG = 2;
/** M8 decision 1: the program refuses older price updates on mainnet. */
export const MAINNET_MAX_PRICE_AGE_S = 20;
/** `["swap_authority"]`. */
export const SWAP_AUTHORITY_SEED = "swap_authority";

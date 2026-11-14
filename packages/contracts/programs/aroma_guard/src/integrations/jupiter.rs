//! Reserved for M8: the Jupiter CPI wrapper for the mainnet build (CONTRACT-V1-SPEC §6, step 4).
//! The keeper builds routes off-chain; the program will trust only the oracle floor (`min_out`)
//! and the owner's balance change, never the route. Nothing here is called in M6: the mainnet
//! `execute_installment` fails closed with `MainnetExecutionUnavailable`.

use anchor_lang::prelude::*;

/// Jupiter Aggregator v6.
pub const JUPITER_V6_PROGRAM_ID: Pubkey = pubkey!("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

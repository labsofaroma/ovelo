//! Pure acceptance rules of a mainnet (Jupiter) leg (M8). `instructions/execute/route.rs` calls
//! exactly these functions; `swap_math_tests.rs` proptests them over whole schedules.
//!
//! The oracle floor is computed on the leg's **full** funding (CONTRACT-V1-SPEC §6:
//! `expected_out = leg_funding / price`), so a protocol fee comes out of the slippage budget and
//! never lowers what the owner is guaranteed to receive (M8 B2).

use crate::constants::MAINNET_MAX_PRICE_AGE_S;
use crate::errors::GuardError;
use crate::math::{bps_of, expected_out, min_out, MathResult};

/// The executor-price bound of M8 decision 1: never older than `MAINNET_MAX_PRICE_AGE_S`, and
/// never older than the config allows.
pub fn effective_max_price_age(config_max_staleness_s: u32) -> u32 {
    config_max_staleness_s.min(MAINNET_MAX_PRICE_AGE_S)
}

/// What one leg spends and the least it must deliver.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LegTerms {
    /// Funding for this leg (weight split of the installment).
    pub leg_funding: u64,
    /// Protocol fee, taken from `leg_funding`.
    pub fee: u64,
    /// `leg_funding − fee`: what the route must spend, exactly.
    pub amount_in: u64,
    /// Oracle value of `leg_funding` in output units (rounded down).
    pub expected_out: u64,
    /// `expected_out × (10,000 − slippage) / 10,000` (rounded down).
    pub min_out: u64,
}

#[allow(clippy::too_many_arguments)]
pub fn leg_terms(
    leg_funding: u64,
    protocol_fee_bps: u16,
    funding_decimals: u8,
    output_decimals: u8,
    price: i64,
    expo: i32,
    multiplier_fp: u128,
    slippage_bps: u16,
) -> MathResult<LegTerms> {
    let fee = bps_of(leg_funding, protocol_fee_bps)?;
    let amount_in = leg_funding.checked_sub(fee).ok_or(GuardError::MathOverflow)?;
    let expected = expected_out(leg_funding, funding_decimals, output_decimals, price, expo, multiplier_fp)?;
    if expected == 0 || amount_in == 0 {
        return Err(GuardError::ZeroOutput);
    }
    Ok(LegTerms { leg_funding, fee, amount_in, expected_out: expected, min_out: min_out(expected, slippage_bps)? })
}

/// Balances around one leg. `source` is the swap authority's funding account before the program
/// funds it; `transit` is its output-mint account; `destination` is the owner's ATA.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SwapBalances {
    pub staging_before: u64,
    pub staging_after: u64,
    pub source_before: u64,
    pub source_after: u64,
    pub transit_before: u64,
    pub transit_after: u64,
    pub destination_before: u64,
    pub destination_after: u64,
}

/// Accepts a leg only when staging paid exactly `leg_funding`, the swap authority's accounts are
/// back where they started (the route spent exactly what it was given and kept nothing), and the
/// owner received at least `min_out`. Returns what the owner received.
pub fn verify_swap(b: &SwapBalances, t: &LegTerms) -> MathResult<u64> {
    if b.staging_before.checked_sub(b.staging_after) != Some(t.leg_funding) {
        return Err(GuardError::SwapBalanceMismatch);
    }
    if b.source_after != b.source_before || b.transit_after != b.transit_before {
        return Err(GuardError::SwapBalanceMismatch);
    }
    let received = b
        .destination_after
        .checked_sub(b.destination_before)
        .ok_or(GuardError::OutputBelowMinimum)?;
    if received < t.min_out {
        return Err(GuardError::OutputBelowMinimum);
    }
    Ok(received)
}

#[cfg(test)]
#[path = "swap_math_tests.rs"]
mod swap_math_tests;

//! Jupiter Aggregator v6 CPI wrapper (default/mainnet build only; CONTRACT-V1-SPEC §6, step 4).
//!
//! **Which instruction:** `route_v2` (discriminator `[187, 100, 250, 204, 49, 196, 175, 20]`) of
//! program `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4`, as pinned from Jupiter's program-owned
//! mainnet IDL (`apps/web/lib/sdk/jupiter/idl/README.md`, IDL SHA-256 `3f0edbf2…c460`). Why
//! `route_v2`: it is what Jupiter's Swap API v2 `/build` returns for an ExactIn route (checked
//! read-only on 2026-11-14, also with `useSharedAccounts=true`), it names the source and destination
//! token programs separately (classic SPL USDC in, Token-2022 xStock out), and its fixed arguments
//! come before the route vector, so the program reads `in_amount` and the fee fields at fixed
//! offsets. Every other Jupiter instruction (v1 routes, shared-accounts, ledger and ExactOut
//! variants) is refused.
//!
//! The program does not trust the route: it checks the fixed account prefix (authority, source,
//! transit, mints, token programs, destination = the owner's ATA, event authority, program), the
//! amount and fee terms, and refuses forbidden accounts before the CPI; after the CPI it checks
//! balances only (`math::verify_swap`). Jupiter's own `route_plan` is never parsed or relied on.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};

use crate::errors::GuardError;

/// Jupiter Aggregator v6.
pub const JUPITER_V6_PROGRAM_ID: Pubkey = pubkey!("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
/// Jupiter's Anchor event-authority PDA (fixed address in its IDL).
pub const JUPITER_EVENT_AUTHORITY: Pubkey = pubkey!("D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf");
/// `sha256("global:route_v2")[..8]`, from the pinned IDL.
pub const ROUTE_V2_DISCRIMINATOR: [u8; 8] = [187, 100, 250, 204, 49, 196, 175, 20];
/// Logged once per routed execution; `scripts/check-build.mjs` requires it in the default binary
/// and its absence from the devnet-mock binary.
pub const JUPITER_CPI_MARKER: &str = "ovelo-guard: jupiter route_v2 cpi";

/// `route_v2` fixed accounts (pinned IDL order). Hop accounts follow from index `PREFIX_LEN`.
pub mod prefix {
    pub const AUTHORITY: usize = 0;
    pub const SOURCE: usize = 1;
    /// `user_destination_token_account`: the swap output lands here first (authority-owned).
    pub const TRANSIT: usize = 2;
    pub const SOURCE_MINT: usize = 3;
    pub const DESTINATION_MINT: usize = 4;
    pub const SOURCE_TOKEN_PROGRAM: usize = 5;
    pub const DESTINATION_TOKEN_PROGRAM: usize = 6;
    /// Optional `destination_token_account`; required here and must be the owner's ATA.
    pub const DESTINATION: usize = 7;
    pub const EVENT_AUTHORITY: usize = 8;
    pub const PROGRAM: usize = 9;
    pub const PREFIX_LEN: usize = 10;
}

/// Fixed arguments of `route_v2`: `in_amount u64, quoted_out_amount u64, slippage_bps u16,
/// platform_fee_bps u16, positive_slippage_bps u16`, then `route_plan: Vec<RoutePlanStepV2>`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RouteV2Terms {
    pub in_amount: u64,
    pub quoted_out_amount: u64,
    pub slippage_bps: u16,
    pub platform_fee_bps: u16,
    pub positive_slippage_bps: u16,
    pub route_steps: u32,
}

/// Discriminator 8 + amounts 16 + three u16 6 + the route vector's u32 length 4.
pub const ROUTE_V2_HEAD_LEN: usize = 34;
/// Upper bound on the instruction data the program forwards (Jupiter's own build stays far below).
pub const MAX_ROUTE_DATA_LEN: usize = 1_024;

fn u64_at(data: &[u8], at: usize) -> u64 {
    let mut b = [0u8; 8];
    b.copy_from_slice(&data[at..at + 8]);
    u64::from_le_bytes(b)
}
fn u16_at(data: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([data[at], data[at + 1]])
}

/// Reads the fixed head of a `route_v2` instruction. Fails closed on any other discriminator,
/// a short buffer, an empty route or data above `MAX_ROUTE_DATA_LEN`.
pub fn parse_route_v2(data: &[u8]) -> core::result::Result<RouteV2Terms, GuardError> {
    if data.len() < ROUTE_V2_HEAD_LEN || data.len() > MAX_ROUTE_DATA_LEN || data[..8] != ROUTE_V2_DISCRIMINATOR {
        return Err(GuardError::UnsupportedRoute);
    }
    let route_steps = u32::from_le_bytes([data[30], data[31], data[32], data[33]]);
    if route_steps == 0 {
        return Err(GuardError::UnsupportedRoute);
    }
    Ok(RouteV2Terms {
        in_amount: u64_at(data, 8),
        quoted_out_amount: u64_at(data, 16),
        slippage_bps: u16_at(data, 24),
        platform_fee_bps: u16_at(data, 26),
        positive_slippage_bps: u16_at(data, 28),
        route_steps,
    })
}

/// The route must spend exactly the leg's `amount_in` and give nothing to Jupiter-side fees
/// (a platform fee or a positive-slippage share would come out of the owner's output).
pub fn check_route_terms(terms: &RouteV2Terms, amount_in: u64) -> core::result::Result<(), GuardError> {
    if terms.in_amount != amount_in || terms.platform_fee_bps != 0 || terms.positive_slippage_bps != 0 {
        return Err(GuardError::RouteTermsMismatch);
    }
    Ok(())
}

/// The CPI instruction: every account in the order the keeper passed it, writable exactly as in
/// the outer transaction, and a signer only where it is the swap authority (no other signature,
/// including the keeper's, reaches Jupiter).
pub fn route_instruction(accounts: &[AccountInfo], data: Vec<u8>, swap_authority: &Pubkey) -> Instruction {
    Instruction {
        program_id: JUPITER_V6_PROGRAM_ID,
        accounts: accounts
            .iter()
            .map(|a| AccountMeta {
                pubkey: *a.key,
                is_signer: a.key == swap_authority,
                is_writable: a.is_writable,
            })
            .collect(),
        data,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn route(in_amount: u64, fee: u16, positive: u16, steps: u32) -> Vec<u8> {
        let mut d = ROUTE_V2_DISCRIMINATOR.to_vec();
        d.extend_from_slice(&in_amount.to_le_bytes());
        d.extend_from_slice(&2_799_975u64.to_le_bytes());
        d.extend_from_slice(&100u16.to_le_bytes());
        d.extend_from_slice(&fee.to_le_bytes());
        d.extend_from_slice(&positive.to_le_bytes());
        d.extend_from_slice(&steps.to_le_bytes());
        d.extend_from_slice(&[7u8; 12]); // opaque route plan bytes, never parsed here
        d
    }

    #[test]
    fn discriminator_is_the_anchor_hash_of_route_v2() {
        use sha2::{Digest, Sha256};
        let hash = Sha256::digest(b"global:route_v2");
        assert_eq!(&hash[..8], &ROUTE_V2_DISCRIMINATOR);
    }

    #[test]
    fn parses_the_fixed_head() {
        let t = parse_route_v2(&route(10_000_000, 0, 0, 1)).unwrap();
        assert_eq!(
            t,
            RouteV2Terms {
                in_amount: 10_000_000,
                quoted_out_amount: 2_799_975,
                slippage_bps: 100,
                platform_fee_bps: 0,
                positive_slippage_bps: 0,
                route_steps: 1
            }
        );
        assert_eq!(check_route_terms(&t, 10_000_000), Ok(()));
    }

    #[test]
    fn refuses_other_instructions_short_empty_or_oversized_data() {
        let good = route(1, 0, 0, 1);
        let mut shared_v2 = good.clone();
        shared_v2[..8].copy_from_slice(&[209, 152, 83, 147, 124, 254, 216, 233]);
        let mut legacy = good.clone();
        legacy[..8].copy_from_slice(&[229, 23, 203, 151, 122, 227, 173, 42]);
        let mut huge = good.clone();
        huge.resize(MAX_ROUTE_DATA_LEN + 1, 0);
        for bad in [&shared_v2[..], &legacy[..], &good[..33], &route(1, 0, 0, 0)[..], &huge[..]] {
            assert_eq!(parse_route_v2(bad), Err(GuardError::UnsupportedRoute));
        }
    }

    #[test]
    fn terms_must_match_the_leg_with_no_jupiter_fees() {
        for (data, amount) in [(route(9, 0, 0, 1), 10), (route(10, 1, 0, 1), 10), (route(10, 0, 50, 1), 10)] {
            let t = parse_route_v2(&data).unwrap();
            assert_eq!(check_route_terms(&t, amount), Err(GuardError::RouteTermsMismatch));
        }
    }

    #[test]
    fn instruction_signs_only_with_the_swap_authority() {
        let (authority, other, writable) = (Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique());
        let owner = Pubkey::default();
        let (mut l1, mut l2, mut l3) = (0u64, 0u64, 0u64);
        let (mut d1, mut d2, mut d3) = (vec![], vec![], vec![]);
        let infos = [
            AccountInfo::new(&authority, false, false, &mut l1, &mut d1, &owner, false),
            AccountInfo::new(&other, true, false, &mut l2, &mut d2, &owner, false),
            AccountInfo::new(&writable, false, true, &mut l3, &mut d3, &owner, false),
        ];
        let ix = route_instruction(&infos, vec![1, 2], &authority);
        assert_eq!(ix.program_id, JUPITER_V6_PROGRAM_ID);
        let flags: Vec<(bool, bool)> = ix.accounts.iter().map(|m| (m.is_signer, m.is_writable)).collect();
        // The keeper-style signer at index 1 is NOT forwarded as a signer.
        assert_eq!(flags, vec![(true, false), (false, false), (false, true)]);
    }
}

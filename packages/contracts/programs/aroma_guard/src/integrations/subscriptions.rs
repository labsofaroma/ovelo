//! Typed layout of the Solana Foundation Subscriptions program (closes AUDIT H-3).
//!
//! Pinned upstream: `solana-foundation/subscriptions` tag **`program-v0.5.0`** (release commit
//! `364a41976c33347d092902443bbec2def9227e75`), the version the TypeScript client
//! `@solana/subscriptions@0.5.0` targets. Source of each layout:
//! - `program/src/state/header.rs`: `Header` (`#[repr(C, packed)]`, 107 bytes, offsets asserted
//!   upstream: discriminator 0, version 1, bump 2, delegator 3, delegatee 35, payer 67, init_id 99).
//! - `program/src/state/recurring_delegation.rs`: `RecurringDelegation` = `Header` + authority +
//!   mint + 5 × 8-byte fields, `LEN = V1_LEN = 211`.
//! - `program/src/state/subscription_authority.rs`: `SubscriptionAuthority`, `LEN = 106`.
//! - `program/src/state/common.rs`: `AccountDiscriminator` (SubscriptionAuthority = 0,
//!   RecurringDelegation = 3); `program/src/state/versioning/core.rs`: `CURRENT_VERSION = 1`.
//! - `program/src/instructions/transfer_recurring_delegation.rs`: discriminator 5, data
//!   `amount u64 | delegator | mint`, 9 accounts.
//!
//! Every read checks the owner, the exact length, the discriminator and (for delegations) the
//! version. A future upstream layout fails closed here instead of being misparsed.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};

use crate::errors::GuardError;

pub const SUBSCRIPTIONS_PROGRAM_ID: Pubkey = pubkey!("De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44");
pub const UPSTREAM_TAG: &str = "program-v0.5.0";

pub const AUTHORITY_SEED: &[u8] = b"SubscriptionAuthority";
pub const DELEGATION_SEED: &[u8] = b"delegation";
pub const EVENT_AUTHORITY_SEED: &[u8] = b"event_authority";

pub const SUBSCRIPTION_AUTHORITY_LEN: usize = 106;
pub const RECURRING_DELEGATION_LEN: usize = 211;
pub const DISCRIMINATOR_SUBSCRIPTION_AUTHORITY: u8 = 0;
pub const DISCRIMINATOR_RECURRING_DELEGATION: u8 = 3;
pub const HEADER_VERSION: u8 = 1;
pub const TRANSFER_RECURRING_DISCRIMINATOR: u8 = 5;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SubscriptionAuthorityView {
    pub user: Pubkey,
    pub token_mint: Pubkey,
    pub payer: Pubkey,
    pub bump: u8,
    pub init_id: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RecurringDelegationView {
    pub version: u8,
    pub bump: u8,
    pub delegator: Pubkey,
    pub delegatee: Pubkey,
    pub payer: Pubkey,
    pub init_id: i64,
    pub subscription_authority: Pubkey,
    pub mint: Pubkey,
    pub current_period_start_ts: i64,
    pub period_length_s: u64,
    pub expiry_ts: i64,
    pub amount_per_period: u64,
    pub amount_pulled_in_period: u64,
}

fn key_at(data: &[u8], at: usize) -> Pubkey {
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(&data[at..at + 32]);
    Pubkey::new_from_array(bytes)
}
fn i64_at(data: &[u8], at: usize) -> i64 {
    let mut bytes = [0u8; 8];
    bytes.copy_from_slice(&data[at..at + 8]);
    i64::from_le_bytes(bytes)
}
fn u64_at(data: &[u8], at: usize) -> u64 {
    let mut bytes = [0u8; 8];
    bytes.copy_from_slice(&data[at..at + 8]);
    u64::from_le_bytes(bytes)
}

/// Exact length and discriminator, then field reads at the upstream offsets.
pub fn parse_subscription_authority(data: &[u8]) -> core::result::Result<SubscriptionAuthorityView, GuardError> {
    if data.len() != SUBSCRIPTION_AUTHORITY_LEN || data[0] != DISCRIMINATOR_SUBSCRIPTION_AUTHORITY {
        return Err(GuardError::InvalidSubscriptionAccount);
    }
    Ok(SubscriptionAuthorityView {
        user: key_at(data, 1),
        token_mint: key_at(data, 33),
        payer: key_at(data, 65),
        bump: data[97],
        init_id: i64_at(data, 98),
    })
}

/// Exact length, discriminator and header version, then field reads at the upstream offsets.
pub fn parse_recurring_delegation(data: &[u8]) -> core::result::Result<RecurringDelegationView, GuardError> {
    if data.len() != RECURRING_DELEGATION_LEN
        || data[0] != DISCRIMINATOR_RECURRING_DELEGATION
        || data[1] != HEADER_VERSION
    {
        return Err(GuardError::InvalidSubscriptionAccount);
    }
    Ok(RecurringDelegationView {
        version: data[1],
        bump: data[2],
        delegator: key_at(data, 3),
        delegatee: key_at(data, 35),
        payer: key_at(data, 67),
        init_id: i64_at(data, 99),
        subscription_authority: key_at(data, 107),
        mint: key_at(data, 139),
        current_period_start_ts: i64_at(data, 171),
        period_length_s: u64_at(data, 179),
        expiry_ts: i64_at(data, 187),
        amount_per_period: u64_at(data, 195),
        amount_pulled_in_period: u64_at(data, 203),
    })
}

pub fn authority_address(user: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[AUTHORITY_SEED, user.as_ref(), mint.as_ref()], &SUBSCRIPTIONS_PROGRAM_ID).0
}

pub fn delegation_address(authority: &Pubkey, delegator: &Pubkey, delegatee: &Pubkey, nonce: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[DELEGATION_SEED, authority.as_ref(), delegator.as_ref(), delegatee.as_ref(), &nonce.to_le_bytes()],
        &SUBSCRIPTIONS_PROGRAM_ID,
    )
    .0
}

/// Terms a plan requires of its delegation (see `math::delegation_terms`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExpectedDelegation {
    pub owner: Pubkey,
    pub plan: Pubkey,
    pub mint: Pubkey,
    pub nonce: u64,
    pub period_seconds: u64,
    pub amount_per_period: u64,
    pub starts_at: i64,
    pub expiry: i64,
}

/// Reads and checks both Subscriptions accounts against the plan. Returns the authority's
/// current `init_id` (binds the plan to one delegation generation).
pub fn verify_delegation(
    authority: &AccountInfo,
    delegation: &AccountInfo,
    expected: &ExpectedDelegation,
    at_creation: bool,
) -> Result<i64> {
    require_keys_eq!(*authority.owner, SUBSCRIPTIONS_PROGRAM_ID, GuardError::InvalidSubscriptionAccount);
    require_keys_eq!(*delegation.owner, SUBSCRIPTIONS_PROGRAM_ID, GuardError::InvalidSubscriptionAccount);
    let expected_authority = authority_address(&expected.owner, &expected.mint);
    require_keys_eq!(authority.key(), expected_authority, GuardError::InvalidSubscriptionAccount);
    let expected_delegation = delegation_address(&expected_authority, &expected.owner, &expected.plan, expected.nonce);
    require_keys_eq!(delegation.key(), expected_delegation, GuardError::InvalidSubscriptionAccount);

    let a = parse_subscription_authority(&authority.try_borrow_data()?)?;
    let d = parse_recurring_delegation(&delegation.try_borrow_data()?)?;
    let terms_ok = a.user == expected.owner
        && a.token_mint == expected.mint
        && d.delegator == expected.owner
        && d.delegatee == expected.plan
        && d.subscription_authority == expected_authority
        && d.mint == expected.mint
        && d.init_id == a.init_id
        && d.period_length_s == expected.period_seconds
        && d.amount_per_period == expected.amount_per_period
        && d.expiry_ts == expected.expiry
        // The delegation's period grid must be the plan's: its current start is the plan start
        // plus whole periods (upstream advances it by whole multiples only).
        && d.current_period_start_ts >= expected.starts_at
        && (d.current_period_start_ts - expected.starts_at) % (expected.period_seconds as i64) == 0;
    require!(terms_ok, GuardError::DelegationTermsMismatch);
    if at_creation {
        require!(
            d.current_period_start_ts == expected.starts_at && d.amount_pulled_in_period == 0,
            GuardError::DelegationTermsMismatch
        );
    }
    Ok(a.init_id)
}

/// `TransferRecurring` (discriminator 5). Account order from upstream `DelegationTransferAccounts`.
#[allow(clippy::too_many_arguments)]
pub fn transfer_recurring_ix(
    delegation: Pubkey,
    authority: Pubkey,
    source: Pubkey,
    receiver: Pubkey,
    mint: Pubkey,
    token_program: Pubkey,
    delegatee: Pubkey,
    event_authority: Pubkey,
    delegator: Pubkey,
    amount: u64,
) -> Instruction {
    let mut data = Vec::with_capacity(1 + 8 + 32 + 32);
    data.push(TRANSFER_RECURRING_DISCRIMINATOR);
    data.extend_from_slice(&amount.to_le_bytes());
    data.extend_from_slice(delegator.as_ref());
    data.extend_from_slice(mint.as_ref());
    Instruction {
        program_id: SUBSCRIPTIONS_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(delegation, false),
            AccountMeta::new_readonly(authority, false),
            AccountMeta::new(source, false),
            AccountMeta::new(receiver, false),
            AccountMeta::new_readonly(mint, false),
            AccountMeta::new_readonly(token_program, false),
            AccountMeta::new_readonly(delegatee, true),
            AccountMeta::new_readonly(event_authority, false),
            AccountMeta::new_readonly(SUBSCRIPTIONS_PROGRAM_ID, false),
        ],
        data,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn authority_bytes(user: Pubkey, mint: Pubkey, init_id: i64) -> Vec<u8> {
        let mut d = vec![0u8; SUBSCRIPTION_AUTHORITY_LEN];
        d[0] = 0;
        d[1..33].copy_from_slice(user.as_ref());
        d[33..65].copy_from_slice(mint.as_ref());
        d[65..97].copy_from_slice(user.as_ref());
        d[97] = 254;
        d[98..106].copy_from_slice(&init_id.to_le_bytes());
        d
    }

    fn delegation_bytes() -> Vec<u8> {
        let mut d = vec![0u8; RECURRING_DELEGATION_LEN];
        d[0] = 3;
        d[1] = 1;
        d[2] = 253;
        for (i, at) in [3usize, 35, 67, 107, 139].iter().enumerate() {
            d[*at..*at + 32].copy_from_slice(&[i as u8 + 1; 32]);
        }
        d[99..107].copy_from_slice(&7i64.to_le_bytes());
        d[171..179].copy_from_slice(&1_000i64.to_le_bytes());
        d[179..187].copy_from_slice(&60u64.to_le_bytes());
        d[187..195].copy_from_slice(&1_240i64.to_le_bytes());
        d[195..203].copy_from_slice(&200u64.to_le_bytes());
        d[203..211].copy_from_slice(&5u64.to_le_bytes());
        d
    }

    #[test]
    fn parses_the_pinned_authority_layout() {
        let (user, mint) = (Pubkey::new_unique(), Pubkey::new_unique());
        let view = parse_subscription_authority(&authority_bytes(user, mint, -9)).unwrap();
        assert_eq!(view, SubscriptionAuthorityView { user, token_mint: mint, payer: user, bump: 254, init_id: -9 });
    }

    #[test]
    fn parses_the_pinned_recurring_delegation_layout() {
        let v = parse_recurring_delegation(&delegation_bytes()).unwrap();
        assert_eq!(v.version, 1);
        assert_eq!(v.bump, 253);
        assert_eq!(v.delegator, Pubkey::new_from_array([1; 32]));
        assert_eq!(v.delegatee, Pubkey::new_from_array([2; 32]));
        assert_eq!(v.payer, Pubkey::new_from_array([3; 32]));
        assert_eq!(v.subscription_authority, Pubkey::new_from_array([4; 32]));
        assert_eq!(v.mint, Pubkey::new_from_array([5; 32]));
        assert_eq!(v.init_id, 7);
        assert_eq!(v.current_period_start_ts, 1_000);
        assert_eq!(v.period_length_s, 60);
        assert_eq!(v.expiry_ts, 1_240);
        assert_eq!(v.amount_per_period, 200);
        assert_eq!(v.amount_pulled_in_period, 5);
    }

    #[test]
    fn rejects_wrong_length_discriminator_or_version() {
        let good = delegation_bytes();
        let mut longer = good.clone();
        longer.push(0);
        let mut wrong_disc = good.clone();
        wrong_disc[0] = 2; // FixedDelegation
        let mut future = good.clone();
        future[1] = 2;
        for bad in [&good[..210], &longer[..], &wrong_disc[..], &future[..]] {
            assert_eq!(parse_recurring_delegation(bad), Err(GuardError::InvalidSubscriptionAccount));
        }
        let auth = authority_bytes(Pubkey::new_unique(), Pubkey::new_unique(), 1);
        let mut auth_disc = auth.clone();
        auth_disc[0] = 3;
        assert_eq!(parse_subscription_authority(&auth[..105]), Err(GuardError::InvalidSubscriptionAccount));
        assert_eq!(parse_subscription_authority(&auth_disc), Err(GuardError::InvalidSubscriptionAccount));
    }

    #[test]
    fn transfer_instruction_matches_upstream_encoding() {
        let k = |b: u8| Pubkey::new_from_array([b; 32]);
        let ix = transfer_recurring_ix(k(1), k(2), k(3), k(4), k(5), k(6), k(7), k(8), k(9), 42);
        assert_eq!(ix.data[0], 5);
        assert_eq!(&ix.data[1..9], &42u64.to_le_bytes());
        assert_eq!(&ix.data[9..41], k(9).as_ref());
        assert_eq!(&ix.data[41..73], k(5).as_ref());
        assert_eq!(ix.accounts.len(), 9);
        assert!(ix.accounts[6].is_signer && !ix.accounts[6].is_writable);
        assert!(ix.accounts[0].is_writable && ix.accounts[2].is_writable && ix.accounts[3].is_writable);
    }
}

//! `execute_installment(period, leg_mask)` and `execute_installment_routed(period, leg_mask,
//! routes)` (CONTRACT-V1-SPEC §6). One accounts struct for both instructions and both builds, so
//! the IDL and the generated client are identical. Which handlers do something is decided at
//! compile time: `devnet_mock.rs` (feature `devnet-mock`) mints at the oracle price through
//! `execute_installment` and refuses the routed instruction; `mainnet.rs` (default) contains no
//! minting code, refuses `execute_installment` and swaps through Jupiter in the routed one.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::errors::GuardError;
use crate::integrations::subscriptions::{EVENT_AUTHORITY_SEED, SUBSCRIPTIONS_PROGRAM_ID};
use crate::state::{Config, Plan};

#[cfg(feature = "devnet-mock")]
pub mod devnet_mock;
#[cfg(feature = "devnet-mock")]
pub use devnet_mock::execute_installment_handler;

#[cfg(not(feature = "devnet-mock"))]
pub mod common;
#[cfg(not(feature = "devnet-mock"))]
pub mod mainnet;
#[cfg(not(feature = "devnet-mock"))]
pub mod route;
#[cfg(not(feature = "devnet-mock"))]
pub use mainnet::{execute_installment_handler, execute_installment_routed_handler};

/// The devnet-mock build has no swap path.
#[cfg(feature = "devnet-mock")]
pub fn execute_installment_routed_handler<'info>(
    _ctx: Context<'info, ExecuteInstallment<'info>>,
    _period: u16,
    _leg_mask: u32,
    _routes: Vec<RouteLeg>,
) -> Result<()> {
    err!(GuardError::RoutedExecutionUnavailable)
}

/// One leg's Jupiter instruction for `execute_installment_routed`: its accounts are the next
/// `account_count` remaining accounts after the leg's `[asset, price_update]`, and `data` is the
/// Jupiter `route_v2` instruction data, forwarded unchanged after the program's checks.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct RouteLeg {
    pub account_count: u8,
    pub data: Vec<u8>,
}

/// Remaining accounts, per leg in `leg_mask` (ascending leg index).
/// `execute_installment` (devnet-mock), `ACCOUNTS_PER_LEG` each: `[asset, output_mint (mut),
/// owner_output_token (mut), price_update, mock_mint_authority, output_token_program]`.
/// `execute_installment_routed` (mainnet): `[asset, price_update, …route]` with
/// `RouteLeg.account_count` route accounts (`route.rs`). `treasury_token` is unused there.
#[derive(Accounts)]
pub struct ExecuteInstallment<'info> {
    /// The keeper (or anyone when `config.keeper_authority` is `None`); pays fees only.
    pub keeper: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump,
        constraint = config.version == ACCOUNT_VERSION @ GuardError::UnsupportedVersion)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut,
        seeds = [PLAN_SEED, plan.owner.as_ref(), plan.funding_mint.as_ref(), &plan.nonce.to_le_bytes()],
        bump = plan.bump,
        has_one = funding_mint @ GuardError::InvalidTokenAccount,
        has_one = funding_token_program @ GuardError::InvalidTokenAccount,
        constraint = plan.version == ACCOUNT_VERSION @ GuardError::UnsupportedVersion)]
    pub plan: Box<Account<'info, Plan>>,
    pub funding_mint: Box<InterfaceAccount<'info, Mint>>,
    pub funding_token_program: Interface<'info, TokenInterface>,
    #[account(mut, token::mint = funding_mint, token::authority = plan.owner,
        token::token_program = funding_token_program)]
    pub owner_funding_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, associated_token::mint = funding_mint, associated_token::authority = plan,
        associated_token::token_program = funding_token_program)]
    pub staging: Box<InterfaceAccount<'info, TokenAccount>>,
    /// Receives the spent funding in the devnet build (never burned).
    #[account(mut, token::mint = funding_mint, token::authority = config.treasury,
        token::token_program = funding_token_program)]
    pub treasury_token: Box<InterfaceAccount<'info, TokenAccount>>,
    /// Required when `config.protocol_fee_bps > 0`.
    #[account(mut, token::mint = funding_mint, token::authority = config.fee_recipient,
        token::token_program = funding_token_program)]
    pub fee_token: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
    /// CHECK: address pinned by the plan; typed and checked against the plan's terms.
    #[account(address = plan.subscription_authority @ GuardError::InvalidSubscriptionAccount)]
    pub subscription_authority: UncheckedAccount<'info>,
    /// CHECK: address pinned by the plan; typed and checked against the plan's terms.
    #[account(mut, address = plan.recurring_delegation @ GuardError::InvalidSubscriptionAccount)]
    pub recurring_delegation: UncheckedAccount<'info>,
    /// CHECK: the Subscriptions event-authority PDA.
    #[account(seeds = [EVENT_AUTHORITY_SEED], bump, seeds::program = SUBSCRIPTIONS_PROGRAM_ID)]
    pub subscriptions_event_authority: UncheckedAccount<'info>,
    /// CHECK: the official Subscriptions program.
    #[account(address = SUBSCRIPTIONS_PROGRAM_ID @ GuardError::InvalidSubscriptionAccount, executable)]
    pub subscriptions_program: UncheckedAccount<'info>,
}

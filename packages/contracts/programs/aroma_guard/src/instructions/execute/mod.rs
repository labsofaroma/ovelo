//! `execute_installment(period, leg_mask)` (CONTRACT-V1-SPEC §6). One accounts struct for both
//! builds, so the IDL and the generated client are identical. Which handler exists is decided at
//! compile time: `devnet_mock.rs` (feature `devnet-mock`) mints at the oracle price; `mainnet.rs`
//! (default) contains no minting code and fails closed until M8.

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
pub mod mainnet;
#[cfg(not(feature = "devnet-mock"))]
pub use mainnet::execute_installment_handler;

/// Remaining accounts, per leg in `leg_mask` (ascending leg index), `ACCOUNTS_PER_LEG` each:
/// `[asset, output_mint (mut), owner_output_token (mut), price_update, mock_mint_authority,
/// output_token_program]`.
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

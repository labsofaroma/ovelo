//! Period start and finish of a mainnet (routed) execution (CONTRACT-V1-SPEC §6, steps 1–3 and 5).
//! The rules are those of the devnet-mock handler: oldest runnable period, skips recorded on the
//! first leg, the Subscriptions pull verified to the unit, staging restored at completion.
//! (`collect` mirrors `devnet_mock::collect`; one copy after the M7 rebase, REWRITE-PLAN M8.)

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token_interface::{transfer_checked, TransferChecked};

use super::ExecuteInstallment;
use crate::constants::*;
use crate::errors::GuardError;
use crate::instructions::plan::plan_seeds;
use crate::integrations::subscriptions::{transfer_recurring_ix, verify_delegation, ExpectedDelegation};
use crate::math::{delegation_terms, runnable_period, schedule_index};
use crate::token_policy::read_token_account;

/// Pause, keeper and leg-mask checks. Returns the legs in the mask, ascending.
pub fn entry_checks(ctx: &Context<ExecuteInstallment>, leg_mask: u32, keeper_required: bool) -> Result<Vec<usize>> {
    let config = &ctx.accounts.config;
    require!(!config.paused, GuardError::ProtocolPaused);
    match config.keeper_authority {
        Some(keeper) => require_keys_eq!(ctx.accounts.keeper.key(), keeper, GuardError::NotKeeper),
        None => require!(!keeper_required, GuardError::KeeperRequired),
    }
    let plan = &ctx.accounts.plan;
    require!(!plan.paused_by_owner, GuardError::PlanPaused);
    let all = plan.all_legs_mask();
    require!(
        leg_mask != 0 && leg_mask & !all == 0 && leg_mask & plan.leg_bitmap == 0,
        GuardError::InvalidLegMask
    );
    Ok((0..plan.outputs.len()).filter(|i| leg_mask & (1u32 << i) != 0).collect())
}

/// First leg of a period: the oldest runnable period must be `period`; skips are recorded and the
/// installment is pulled into staging. Later legs: `period` must be the one in flight. Returns the
/// periods newly marked skipped.
pub fn begin_period<'info>(ctx: &mut Context<'info, ExecuteInstallment<'info>>, period: u16, now: i64) -> Result<u16> {
    let plan = &ctx.accounts.plan;
    if plan.leg_bitmap != 0 {
        require!(period == plan.in_progress_period, GuardError::UnexpectedPeriod);
        return Ok(0);
    }
    let index = schedule_index(now, plan.starts_at, plan.period_seconds).ok_or(GuardError::NothingDue)?;
    let due = runnable_period(plan.last_executed_period, plan.periods, plan.catch_up_window_periods, index)?;
    require!(due.period == period, GuardError::UnexpectedPeriod);
    let staging_before = collect(ctx)?;
    let plan = &mut ctx.accounts.plan;
    plan.skipped_periods = plan
        .skipped_periods
        .checked_add(due.newly_skipped)
        .ok_or(GuardError::MathOverflow)?;
    plan.in_progress_period = period;
    plan.staging_start_balance = staging_before;
    Ok(due.newly_skipped)
}

/// Marks the legs done; when the bitmap is full, staging must be back at its start balance and the
/// period is recorded as executed. Returns whether the period completed.
pub fn finish_period(ctx: &mut Context<ExecuteInstallment>, period: u16, leg_mask: u32, now: i64) -> Result<bool> {
    let staging_now = reload_amount(&ctx.accounts.staging.to_account_info())?;
    let plan = &mut ctx.accounts.plan;
    plan.leg_bitmap |= leg_mask;
    if plan.leg_bitmap != plan.all_legs_mask() {
        return Ok(false);
    }
    require!(staging_now == plan.staging_start_balance, GuardError::StagingNotRestored);
    plan.executed_periods = plan.executed_periods.checked_add(1).ok_or(GuardError::MathOverflow)?;
    plan.last_executed_period = period;
    plan.last_executed_at = now;
    plan.leg_bitmap = 0;
    plan.in_progress_period = NO_PERIOD;
    plan.staging_start_balance = 0;
    Ok(true)
}

/// Pulls exactly `funding_amount` through the Subscriptions CPI (the plan PDA signs as delegatee)
/// and verifies the exact debit and credit. Returns staging's balance before the pull.
fn collect<'info>(ctx: &Context<'info, ExecuteInstallment<'info>>) -> Result<u64> {
    let a = &ctx.accounts;
    let plan = &a.plan;
    let (amount_per_period, expiry) =
        delegation_terms(plan.funding_amount, plan.catch_up_window_periods, plan.period_seconds, plan.expires_at)?;
    let init_id = verify_delegation(
        &a.subscription_authority.to_account_info(),
        &a.recurring_delegation.to_account_info(),
        &ExpectedDelegation {
            owner: plan.owner,
            plan: plan.key(),
            mint: plan.funding_mint,
            nonce: plan.nonce,
            period_seconds: plan.period_seconds,
            amount_per_period,
            starts_at: plan.starts_at,
            expiry,
        },
        false,
    )?;
    require!(init_id == plan.subscription_init_id, GuardError::DelegationTermsMismatch);
    let source_before = reload_amount(&a.owner_funding_token.to_account_info())?;
    let staging_before = reload_amount(&a.staging.to_account_info())?;
    let ix = transfer_recurring_ix(
        a.recurring_delegation.key(),
        a.subscription_authority.key(),
        a.owner_funding_token.key(),
        a.staging.key(),
        plan.funding_mint,
        a.funding_token_program.key(),
        plan.key(),
        a.subscriptions_event_authority.key(),
        plan.owner,
        plan.funding_amount,
    );
    let nonce = plan.nonce.to_le_bytes();
    let bump = [plan.bump];
    let seeds = plan_seeds(plan, &nonce, &bump);
    invoke_signed(
        &ix,
        &[
            a.recurring_delegation.to_account_info(),
            a.subscription_authority.to_account_info(),
            a.owner_funding_token.to_account_info(),
            a.staging.to_account_info(),
            a.funding_mint.to_account_info(),
            a.funding_token_program.to_account_info(),
            plan.to_account_info(),
            a.subscriptions_event_authority.to_account_info(),
            a.subscriptions_program.to_account_info(),
        ],
        &[&seeds],
    )?;
    let source_after = reload_amount(&a.owner_funding_token.to_account_info())?;
    let staging_after = reload_amount(&a.staging.to_account_info())?;
    require!(
        source_before.checked_sub(source_after) == Some(plan.funding_amount)
            && staging_after.checked_sub(staging_before) == Some(plan.funding_amount),
        GuardError::FundingBalanceMismatch
    );
    Ok(staging_before)
}

pub fn reload_amount(info: &AccountInfo) -> Result<u64> {
    Ok(read_token_account(info)?.amount)
}

/// Moves `amount` of funding out of staging; the plan PDA signs.
pub fn move_funding<'info>(ctx: &Context<'info, ExecuteInstallment<'info>>, to: AccountInfo<'info>, amount: u64) -> Result<()> {
    let a = &ctx.accounts;
    let plan = &a.plan;
    let nonce = plan.nonce.to_le_bytes();
    let bump = [plan.bump];
    let seeds = plan_seeds(plan, &nonce, &bump);
    transfer_checked(
        CpiContext::new_with_signer(
            a.funding_token_program.key(),
            TransferChecked {
                from: a.staging.to_account_info(),
                mint: a.funding_mint.to_account_info(),
                to,
                authority: plan.to_account_info(),
            },
            &[&seeds],
        ),
        amount,
        a.funding_mint.decimals,
    )
}

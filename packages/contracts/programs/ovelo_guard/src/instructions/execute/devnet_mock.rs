//! Devnet build (`devnet-mock`). Mints test stock at the oracle price from a per-asset PDA
//! `["mock_mint", mint]` and moves the leg's funding to the treasury, never burns it. Nothing
//! is minted beyond the oracle value of funding that was actually pulled.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use anchor_spl::token_interface::{mint_to, transfer_checked, MintTo, TransferChecked};

use super::ExecuteInstallment;
use crate::constants::*;
use crate::errors::GuardError;
use crate::events::{InstallmentExecuted, LegExecuted};
use crate::instructions::plan::plan_seeds;
use crate::integrations::pyth::read_price;
use crate::integrations::subscriptions::{transfer_recurring_ix, verify_delegation, ExpectedDelegation};
use crate::math::{bps_of, delegation_terms, expected_out, leg_amount, min_out, runnable_period, schedule_index};
use crate::state::{Asset, Config, Output, Plan};
use crate::token_policy::{inspect_mint, read_token_account};

/// Marker string present only in this build (the M6 build check greps the binaries for it).
pub const DEVNET_MOCK_MARKER: &str = "ovelo-guard: devnet-mock mint at oracle price";

pub fn execute_installment_handler<'info>(ctx: Context<'info, ExecuteInstallment<'info>>, period: u16, leg_mask: u32) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let config = &ctx.accounts.config;
    require!(!config.paused, GuardError::ProtocolPaused);
    if let Some(keeper) = config.keeper_authority {
        require_keys_eq!(ctx.accounts.keeper.key(), keeper, GuardError::NotKeeper);
    }
    let plan = &ctx.accounts.plan;
    require!(!plan.paused_by_owner, GuardError::PlanPaused);
    let all = plan.all_legs_mask();
    require!(
        leg_mask != 0 && leg_mask & !all == 0 && leg_mask & plan.leg_bitmap == 0,
        GuardError::InvalidLegMask
    );
    let legs: Vec<usize> = (0..plan.outputs.len()).filter(|i| leg_mask & (1u32 << i) != 0).collect();
    require!(
        ctx.remaining_accounts.len() == legs.len() * ACCOUNTS_PER_LEG,
        GuardError::InvalidRemainingAccounts
    );

    let mut newly_skipped = 0u16;
    if plan.leg_bitmap == 0 {
        let index = schedule_index(now, plan.starts_at, plan.period_seconds).ok_or(GuardError::NothingDue)?;
        let due = runnable_period(plan.last_executed_period, plan.periods, plan.catch_up_window_periods, index)?;
        require!(due.period == period, GuardError::UnexpectedPeriod);
        newly_skipped = due.newly_skipped;
        let staging_before = collect(&ctx)?;
        let plan = &mut ctx.accounts.plan;
        plan.skipped_periods = plan
            .skipped_periods
            .checked_add(newly_skipped)
            .ok_or(GuardError::MathOverflow)?;
        plan.in_progress_period = period;
        plan.staging_start_balance = staging_before;
    } else {
        require!(period == plan.in_progress_period, GuardError::UnexpectedPeriod);
    }

    let mut executed = Vec::with_capacity(legs.len());
    for (k, leg) in legs.iter().enumerate() {
        let accounts = &ctx.remaining_accounts[k * ACCOUNTS_PER_LEG..(k + 1) * ACCOUNTS_PER_LEG];
        executed.push(execute_leg(&ctx, *leg, accounts, now)?);
    }

    let plan = &mut ctx.accounts.plan;
    plan.leg_bitmap |= leg_mask;
    let period_complete = plan.leg_bitmap == all;
    if period_complete {
        ctx.accounts.staging.reload()?;
        require!(ctx.accounts.staging.amount == plan.staging_start_balance, GuardError::StagingNotRestored);
        plan.executed_periods = plan.executed_periods.checked_add(1).ok_or(GuardError::MathOverflow)?;
        plan.last_executed_period = period;
        plan.last_executed_at = now;
        plan.leg_bitmap = 0;
        plan.in_progress_period = NO_PERIOD;
        plan.staging_start_balance = 0;
    }
    msg!(DEVNET_MOCK_MARKER);
    emit!(InstallmentExecuted { plan: plan.key(), period, legs: executed, newly_skipped, period_complete });
    Ok(())
}

/// First leg of a period: pull exactly `funding_amount` through the Subscriptions CPI (the plan
/// PDA signs as delegatee) and verify the exact debit and credit. Returns staging's balance
/// before the pull.
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

    let source_before = a.owner_funding_token.amount;
    let staging_before = a.staging.amount;
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

fn reload_amount(info: &AccountInfo) -> Result<u64> {
    Ok(read_token_account(info)?.amount)
}

fn execute_leg<'info>(
    ctx: &Context<'info, ExecuteInstallment<'info>>,
    leg: usize,
    accounts: &'info [AccountInfo<'info>],
    now: i64,
) -> Result<LegExecuted> {
    let a = &ctx.accounts;
    let config: &Config = &a.config;
    let plan: &Plan = &a.plan;
    let output: Output = plan.outputs[leg];
    let [asset_info, mint_info, destination_info, price_info, authority_info, token_program_info] = accounts else {
        return err!(GuardError::InvalidRemainingAccounts);
    };

    // Asset: this program's PDA for the output mint, current version, enabled.
    let asset: Account<Asset> = Account::try_from(asset_info).map_err(|_| GuardError::AssetMismatch)?;
    let asset_pda =
        Pubkey::create_program_address(&[ASSET_SEED, output.mint.as_ref(), &[asset.bump]], ctx.program_id)
            .map_err(|_| GuardError::AssetMismatch)?;
    require_keys_eq!(asset_info.key(), asset_pda, GuardError::AssetMismatch);
    require!(asset.version == ACCOUNT_VERSION && asset.mint == output.mint, GuardError::AssetMismatch);
    require!(asset.enabled, GuardError::AssetDisabled);

    // Output mint: the asset's mint and token program; the live Token-2022 policy still passes.
    require_keys_eq!(mint_info.key(), output.mint, GuardError::AssetMismatch);
    require_keys_eq!(*mint_info.owner, asset.token_program, GuardError::UnsupportedTokenProgram);
    require_keys_eq!(token_program_info.key(), asset.token_program, GuardError::UnsupportedTokenProgram);
    require!(token_program_info.executable, GuardError::UnsupportedTokenProgram);
    let facts = inspect_mint(&mint_info.try_borrow_data()?, &asset.token_program, config)?;
    require!(facts.decimals == asset.decimals, GuardError::DecimalsChanged);
    require!(!facts.paused, GuardError::MintPaused);
    let authority = Pubkey::create_program_address(
        &[MOCK_MINT_SEED, output.mint.as_ref(), &[asset.mock_mint_bump]],
        ctx.program_id,
    )
    .map_err(|_| GuardError::MockMintAuthorityMismatch)?;
    require_keys_eq!(authority_info.key(), authority, GuardError::MockMintAuthorityMismatch);
    require!(facts.mint_authority == Some(authority), GuardError::MockMintAuthorityMismatch);

    // Destination: exactly the owner's associated token account for this mint.
    let ata = get_associated_token_address_with_program_id(&plan.owner, &output.mint, &asset.token_program);
    require_keys_eq!(destination_info.key(), ata, GuardError::WrongDestination);
    let destination_before = read_token_account(destination_info).map_err(|_| GuardError::WrongDestination)?;
    require!(
        destination_before.owner == plan.owner && destination_before.mint == output.mint,
        GuardError::WrongDestination
    );
    let before = destination_before.amount;

    // Oracle and amounts (math.rs).
    let price = read_price(
        price_info,
        &asset.pyth_feed_id,
        now,
        config.max_oracle_staleness_s,
        config.max_confidence_bps,
    )?;
    let leg_funding = leg_amount(plan.funding_amount, &plan.weights(), leg)?;
    let fee = bps_of(leg_funding, config.protocol_fee_bps)?;
    let amount_in = leg_funding.checked_sub(fee).ok_or(GuardError::MathOverflow)?;
    let multiplier_fp = facts.multiplier_fp(now)?;
    let amount_out =
        expected_out(amount_in, a.funding_mint.decimals, asset.decimals, price.price, price.expo, multiplier_fp)?;
    require!(amount_out > 0, GuardError::ZeroOutput);
    let floor = min_out(amount_out, output.max_slippage_bps)?;

    // Funding: fee to the fee recipient, the rest to the treasury. The plan PDA signs.
    let nonce = plan.nonce.to_le_bytes();
    let bump = [plan.bump];
    let seeds = plan_seeds(plan, &nonce, &bump);
    let funding_program = a.funding_token_program.key();
    if fee > 0 {
        let fee_token = a.fee_token.as_ref().ok_or(GuardError::InvalidTokenAccount)?;
        move_funding(ctx, funding_program, fee_token.to_account_info(), fee, &seeds)?;
    }
    move_funding(ctx, funding_program, a.treasury_token.to_account_info(), amount_in, &seeds)?;

    // Mint exactly the oracle amount from the asset's PDA.
    let mint_bump = [asset.mock_mint_bump];
    let mint_seeds: [&[u8]; 3] = [MOCK_MINT_SEED, output.mint.as_ref(), &mint_bump];
    mint_to(
        CpiContext::new_with_signer(
            token_program_info.key(),
            MintTo { mint: mint_info.clone(), to: destination_info.clone(), authority: authority_info.clone() },
            &[&mint_seeds],
        ),
        amount_out,
    )?;

    let after = reload_amount(destination_info)?;
    let received = after.checked_sub(before).ok_or(GuardError::OutputBelowMinimum)?;
    require!(received >= floor, GuardError::OutputBelowMinimum);
    Ok(LegExecuted {
        leg: u8::try_from(leg).map_err(|_| GuardError::InvalidLegMask)?,
        mint: output.mint,
        amount_in,
        fee,
        amount_out: received,
        min_out: floor,
        oracle_price: price.price,
        oracle_expo: price.expo,
        oracle_publish_time: price.publish_time,
        multiplier_fp,
    })
}

fn move_funding<'info>(
    ctx: &Context<'info, ExecuteInstallment<'info>>,
    program: Pubkey,
    to: AccountInfo<'info>,
    amount: u64,
    seeds: &[&[u8]; 5],
) -> Result<()> {
    let a = &ctx.accounts;
    transfer_checked(
        CpiContext::new_with_signer(
            program,
            TransferChecked {
                from: a.staging.to_account_info(),
                mint: a.funding_mint.to_account_info(),
                to,
                authority: a.plan.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        a.funding_mint.decimals,
    )
}

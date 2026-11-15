use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_option::COption;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::errors::GuardError;
use crate::events::PlanCreated;
use crate::integrations::subscriptions::{verify_delegation, ExpectedDelegation};
use crate::math::{delegation_terms, leg_amount};
use crate::state::{Asset, Config, Output, Plan};

/// A transaction may land a little after the start the wallet signed for.
pub const MAX_START_LAG_SECONDS: i64 = 120;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct CreatePlanArgs {
    pub nonce: u64,
    pub funding_amount: u64,
    pub period_seconds: u64,
    pub starts_at: i64,
    pub periods: u16,
    pub outputs: Vec<Output>,
}

#[derive(Accounts)]
#[instruction(args: CreatePlanArgs)]
pub struct CreatePlan<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump,
        constraint = config.version == ACCOUNT_VERSION @ GuardError::UnsupportedVersion)]
    pub config: Box<Account<'info, Config>>,
    #[account(init, payer = owner, space = 8 + Plan::INIT_SPACE,
        seeds = [PLAN_SEED, owner.key().as_ref(), funding_mint.key().as_ref(), &args.nonce.to_le_bytes()], bump)]
    pub plan: Box<Account<'info, Plan>>,
    #[account(mint::token_program = funding_token_program)]
    pub funding_mint: Box<InterfaceAccount<'info, Mint>>,
    pub funding_token_program: Interface<'info, TokenInterface>,
    #[account(token::mint = funding_mint, token::authority = owner, token::token_program = funding_token_program)]
    pub owner_funding_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(init, payer = owner, associated_token::mint = funding_mint, associated_token::authority = plan,
        associated_token::token_program = funding_token_program)]
    pub staging: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: owner, PDA, exact length and discriminator checked in `verify_delegation`.
    pub subscription_authority: UncheckedAccount<'info>,
    /// CHECK: owner, PDA, exact length, discriminator, version and terms checked in `verify_delegation`.
    pub recurring_delegation: UncheckedAccount<'info>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Pure argument checks (unit-tested in `tests.rs`). Returns `expires_at`.
pub fn validate_args(args: &CreatePlanArgs, config: &Config, funding_mint: &Pubkey, now: i64) -> Result<i64> {
    require!(config.is_funding_mint(funding_mint), GuardError::FundingMintNotAllowed);
    require!(args.funding_amount > 0, GuardError::InvalidSchedule);
    require!(args.funding_amount <= config.max_installment_amount, GuardError::AmountAboveCap);
    require!(
        args.periods >= 1
            && args.period_seconds >= MIN_PERIOD_SECONDS
            && args.period_seconds <= MAX_DURATION_SECONDS,
        GuardError::InvalidSchedule
    );
    let duration = args
        .period_seconds
        .checked_mul(u64::from(args.periods))
        .ok_or(GuardError::InvalidSchedule)?;
    require!(duration <= MAX_DURATION_SECONDS, GuardError::InvalidSchedule);
    require!(
        args.starts_at >= now.saturating_sub(MAX_START_LAG_SECONDS)
            && args.starts_at <= now.saturating_add(MAX_START_DELAY_SECONDS),
        GuardError::InvalidSchedule
    );
    let expires_at = args
        .starts_at
        .checked_add(i64::try_from(duration).map_err(|_| GuardError::MathOverflow)?)
        .ok_or(GuardError::MathOverflow)?;

    let n = args.outputs.len();
    require!((1..=MAX_OUTPUTS).contains(&n), GuardError::InvalidOutputs);
    let mut total: u32 = 0;
    for (i, output) in args.outputs.iter().enumerate() {
        require!(
            output.mint != *funding_mint
                && output.mint != Pubkey::default()
                && args.outputs[..i].iter().all(|o| o.mint != output.mint),
            GuardError::InvalidOutputs
        );
        require!(output.weight_bps > 0, GuardError::InvalidWeights);
        require!(output.max_slippage_bps <= config.max_slippage_bps, GuardError::SlippageAboveCap);
        total = total.checked_add(u32::from(output.weight_bps)).ok_or(GuardError::MathOverflow)?;
    }
    require!(total == u32::from(TOTAL_WEIGHT_BPS), GuardError::InvalidWeights);
    let weights: Vec<u16> = args.outputs.iter().map(|o| o.weight_bps).collect();
    for i in 0..n {
        require!(leg_amount(args.funding_amount, &weights, i)? > 0, GuardError::InvalidWeights);
    }
    Ok(expires_at)
}

pub fn create_plan_handler<'info>(ctx: Context<'info, CreatePlan<'info>>, args: CreatePlanArgs) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let config = &ctx.accounts.config;
    require!(!config.paused, GuardError::ProtocolPaused);
    let funding_mint = ctx.accounts.funding_mint.key();
    let expires_at = validate_args(&args, config, &funding_mint, now)?;

    // Every output must be a registered, enabled asset: one Asset account per output, in order.
    require!(ctx.remaining_accounts.len() == args.outputs.len(), GuardError::InvalidRemainingAccounts);
    for (output, info) in args.outputs.iter().zip(ctx.remaining_accounts.iter()) {
        let asset: Account<Asset> = Account::try_from(info).map_err(|_| GuardError::AssetMismatch)?;
        let expected = Pubkey::find_program_address(&[ASSET_SEED, output.mint.as_ref()], ctx.program_id).0;
        require_keys_eq!(info.key(), expected, GuardError::AssetMismatch);
        require!(asset.version == ACCOUNT_VERSION && asset.mint == output.mint, GuardError::AssetMismatch);
        require!(asset.enabled, GuardError::AssetDisabled);
    }

    // The Subscriptions delegation: canonical PDAs, typed layout, exact terms (spec §5).
    let window = config.catch_up_window_periods;
    let (amount_per_period, expiry) =
        delegation_terms(args.funding_amount, window, args.period_seconds, expires_at)?;
    let owner = ctx.accounts.owner.key();
    let plan_key = ctx.accounts.plan.key();
    let init_id = verify_delegation(
        &ctx.accounts.subscription_authority.to_account_info(),
        &ctx.accounts.recurring_delegation.to_account_info(),
        &ExpectedDelegation {
            owner,
            plan: plan_key,
            mint: funding_mint,
            nonce: args.nonce,
            period_seconds: args.period_seconds,
            amount_per_period,
            starts_at: args.starts_at,
            expiry,
        },
        true,
    )?;
    // The owner's funding account delegates to the SubscriptionAuthority PDA (set by upstream
    // `InitSubscriptionAuthority`), which is what lets the delegation pull.
    require!(
        ctx.accounts.owner_funding_token.delegate == COption::Some(ctx.accounts.subscription_authority.key()),
        GuardError::DelegationTermsMismatch
    );

    let plan = &mut ctx.accounts.plan;
    plan.version = ACCOUNT_VERSION;
    plan.owner = owner;
    plan.funding_mint = funding_mint;
    plan.nonce = args.nonce;
    plan.funding_amount = args.funding_amount;
    plan.period_seconds = args.period_seconds;
    plan.starts_at = args.starts_at;
    plan.expires_at = expires_at;
    plan.created_at = now;
    plan.periods = args.periods;
    plan.executed_periods = 0;
    plan.skipped_periods = 0;
    plan.last_executed_period = NO_PERIOD;
    plan.last_executed_at = 0;
    plan.paused_by_owner = false;
    plan.leg_bitmap = 0;
    plan.subscription_authority = ctx.accounts.subscription_authority.key();
    plan.recurring_delegation = ctx.accounts.recurring_delegation.key();
    plan.subscription_init_id = init_id;
    plan.bump = ctx.bumps.plan;
    plan.funding_token_program = ctx.accounts.funding_token_program.key();
    plan.catch_up_window_periods = window;
    plan.in_progress_period = NO_PERIOD;
    plan.staging_start_balance = 0;
    plan.outputs = args.outputs.clone();
    plan.reserved = [0; 96];
    emit!(PlanCreated {
        plan: plan_key,
        owner,
        funding_mint,
        nonce: args.nonce,
        funding_amount: args.funding_amount,
        period_seconds: args.period_seconds,
        starts_at: args.starts_at,
        expires_at,
        periods: args.periods,
        outputs: u8::try_from(args.outputs.len()).map_err(|_| GuardError::InvalidOutputs)?,
    });
    Ok(())
}

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    close_account, transfer_checked, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::constants::*;
use crate::events::PlanClosed;
use crate::instructions::plan::plan_seeds;
use crate::state::Plan;

/// Always allowed, even when the protocol or the plan is paused (no config account is read).
/// Returns the staging balance to the owner, closes staging and the plan with rent to the
/// owner (AUDIT L-1). The client puts the Subscriptions revoke in the same transaction
/// (`lib/sdk/guard/v1`, AUDIT H-2).
#[derive(Accounts)]
pub struct ClosePlan<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, close = owner, has_one = owner, has_one = funding_mint, has_one = funding_token_program,
        seeds = [PLAN_SEED, plan.owner.as_ref(), plan.funding_mint.as_ref(), &plan.nonce.to_le_bytes()],
        bump = plan.bump)]
    pub plan: Box<Account<'info, Plan>>,
    pub funding_mint: Box<InterfaceAccount<'info, Mint>>,
    pub funding_token_program: Interface<'info, TokenInterface>,
    #[account(mut, associated_token::mint = funding_mint, associated_token::authority = plan,
        associated_token::token_program = funding_token_program)]
    pub staging: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = funding_mint, token::authority = owner, token::token_program = funding_token_program)]
    pub owner_funding_token: Box<InterfaceAccount<'info, TokenAccount>>,
}

pub fn close_plan_handler(ctx: Context<ClosePlan>) -> Result<()> {
    let plan = &ctx.accounts.plan;
    let nonce = plan.nonce.to_le_bytes();
    let bump = [plan.bump];
    let seeds = plan_seeds(plan, &nonce, &bump);
    let signer: &[&[&[u8]]] = &[&seeds];
    let returned_amount = ctx.accounts.staging.amount;
    let program = ctx.accounts.funding_token_program.key();
    if returned_amount > 0 {
        transfer_checked(
            CpiContext::new_with_signer(
                program,
                TransferChecked {
                    from: ctx.accounts.staging.to_account_info(),
                    mint: ctx.accounts.funding_mint.to_account_info(),
                    to: ctx.accounts.owner_funding_token.to_account_info(),
                    authority: plan.to_account_info(),
                },
                signer,
            ),
            returned_amount,
            ctx.accounts.funding_mint.decimals,
        )?;
    }
    close_account(CpiContext::new_with_signer(
        program,
        CloseAccount {
            account: ctx.accounts.staging.to_account_info(),
            destination: ctx.accounts.owner.to_account_info(),
            authority: plan.to_account_info(),
        },
        signer,
    ))?;
    emit!(PlanClosed {
        plan: plan.key(),
        owner: plan.owner,
        returned_amount,
        executed_periods: plan.executed_periods,
        skipped_periods: plan.skipped_periods,
    });
    Ok(())
}

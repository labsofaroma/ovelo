use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::GuardError;
use crate::events::PlanPauseSet;
use crate::state::Plan;

#[derive(Accounts)]
pub struct OwnerPlan<'info> {
    pub owner: Signer<'info>,
    #[account(mut, has_one = owner,
        seeds = [PLAN_SEED, plan.owner.as_ref(), plan.funding_mint.as_ref(), &plan.nonce.to_le_bytes()],
        bump = plan.bump,
        constraint = plan.version == ACCOUNT_VERSION @ GuardError::UnsupportedVersion)]
    pub plan: Box<Account<'info, Plan>>,
}

pub fn set_plan_paused(ctx: Context<OwnerPlan>, paused: bool) -> Result<()> {
    let plan = &mut ctx.accounts.plan;
    require!(plan.paused_by_owner != paused, GuardError::PauseStateUnchanged);
    plan.paused_by_owner = paused;
    emit!(PlanPauseSet { plan: plan.key(), owner: plan.owner, paused });
    Ok(())
}

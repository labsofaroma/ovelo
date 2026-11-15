//! Mainnet build (no `devnet-mock` feature). There is no minting code here or anywhere the default
//! build compiles. `execute_installment` fails closed; installments execute through
//! `execute_installment_routed`, which swaps each leg's funding through Jupiter (`route.rs`) and
//! accepts it only on the oracle floor and the balance changes (CONTRACT-V1-SPEC §6).
//!
//! M8 decision 1: execution is keeper-only in this build (`config.keeper_authority` must be set
//! and sign) and price updates may be at most `MAINNET_MAX_PRICE_AGE_S` old.

use anchor_lang::prelude::*;

use super::common::{begin_period, entry_checks, finish_period};
use super::route::{execute_routed_leg, SwapSigner};
use super::{ExecuteInstallment, RouteLeg};
use crate::constants::*;
use crate::errors::GuardError;
use crate::events::InstallmentExecuted;
use crate::integrations::jupiter::{prefix, JUPITER_CPI_MARKER};

pub fn execute_installment_handler<'info>(
    _ctx: Context<'info, ExecuteInstallment<'info>>,
    _period: u16,
    _leg_mask: u32,
) -> Result<()> {
    err!(GuardError::MainnetExecutionUnavailable)
}

/// Start offset of each leg's accounts in `remaining_accounts`; the total must match exactly.
fn leg_offsets(routes: &[RouteLeg], remaining: usize) -> Result<Vec<usize>> {
    let mut offsets = Vec::with_capacity(routes.len());
    let mut at = 0usize;
    for r in routes {
        require!(usize::from(r.account_count) > prefix::PREFIX_LEN, GuardError::UnsupportedRoute);
        offsets.push(at);
        at = at
            .checked_add(ROUTED_FIXED_ACCOUNTS_PER_LEG + usize::from(r.account_count))
            .ok_or(GuardError::MathOverflow)?;
    }
    require!(at == remaining, GuardError::InvalidRemainingAccounts);
    Ok(offsets)
}

pub fn execute_installment_routed_handler<'info>(
    mut ctx: Context<'info, ExecuteInstallment<'info>>,
    period: u16,
    leg_mask: u32,
    routes: Vec<RouteLeg>,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let legs = entry_checks(&ctx, leg_mask, true)?;
    require!(routes.len() == legs.len(), GuardError::InvalidRemainingAccounts);
    let offsets = leg_offsets(&routes, ctx.remaining_accounts.len())?;
    let newly_skipped = begin_period(&mut ctx, period, now)?;

    let swap = SwapSigner::find(ctx.program_id);
    let mut executed = Vec::with_capacity(legs.len());
    for (k, leg) in legs.iter().enumerate() {
        let end = offsets[k] + ROUTED_FIXED_ACCOUNTS_PER_LEG + usize::from(routes[k].account_count);
        let accounts = &ctx.remaining_accounts[offsets[k]..end];
        executed.push(execute_routed_leg(&ctx, *leg, accounts, &routes[k].data, now, &swap)?);
    }
    msg!(JUPITER_CPI_MARKER);
    let period_complete = finish_period(&mut ctx, period, leg_mask, now)?;
    emit!(InstallmentExecuted {
        plan: ctx.accounts.plan.key(),
        period,
        legs: executed,
        newly_skipped,
        period_complete
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leg_offsets_must_cover_the_remaining_accounts_exactly() {
        let leg = |n: u8| RouteLeg { account_count: n, data: vec![] };
        assert_eq!(leg_offsets(&[leg(31), leg(20)], 2 + 31 + 2 + 20).unwrap(), vec![0, 33]);
        assert!(leg_offsets(&[leg(31)], 32).is_err());
        assert!(leg_offsets(&[leg(31)], 34).is_err());
        // A route needs the whole fixed prefix plus at least one hop account.
        assert!(leg_offsets(&[leg(10)], 12).is_err());
    }
}

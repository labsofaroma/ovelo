//! Mainnet build (no `devnet-mock` feature). There is deliberately no minting code here or
//! anywhere the default build compiles: execution fails closed until the Jupiter path (M8).

use anchor_lang::prelude::*;

use super::ExecuteInstallment;
use crate::errors::GuardError;

pub fn execute_installment_handler<'info>(
    _ctx: Context<'info, ExecuteInstallment<'info>>,
    _period: u16,
    _leg_mask: u32,
) -> Result<()> {
    err!(GuardError::MainnetExecutionUnavailable)
}

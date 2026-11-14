use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::GuardError;
use crate::events::ConfigInitialized;
use crate::state::{Config, ConfigParams};

/// Once, by the program's upgrade authority (read from the ProgramData account).
#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(init, payer = authority, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ GuardError::NotUpgradeAuthority)]
    pub program: Program<'info, crate::program::AromaGuard>,
    #[account(constraint = program_data.upgrade_authority_address == Some(authority.key()) @ GuardError::NotUpgradeAuthority)]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_config_handler(ctx: Context<InitializeConfig>, params: ConfigParams) -> Result<()> {
    require!(params.is_valid(), GuardError::InvalidConfig);
    let config = &mut ctx.accounts.config;
    config.version = ACCOUNT_VERSION;
    config.paused = false;
    config.bump = ctx.bumps.config;
    config.reserved = [0; 128];
    config.apply(&params);
    emit!(ConfigInitialized { admin: config.admin, keeper_authority: config.keeper_authority });
    Ok(())
}

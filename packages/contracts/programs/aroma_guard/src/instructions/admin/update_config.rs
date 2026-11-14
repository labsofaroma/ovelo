use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::GuardError;
use crate::events::ConfigUpdated;
use crate::state::{Config, ConfigParams};

#[derive(Accounts)]
pub struct AdminConfig<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ GuardError::NotAdmin,
        constraint = config.version == ACCOUNT_VERSION @ GuardError::UnsupportedVersion)]
    pub config: Box<Account<'info, Config>>,
}

/// Replaces every settable value (including `admin` and `keeper_authority`, which may be set
/// to `None` so that anyone can execute). `paused` is changed only by `set_paused`.
pub fn update_config_handler(ctx: Context<AdminConfig>, params: ConfigParams) -> Result<()> {
    require!(params.is_valid(), GuardError::InvalidConfig);
    let config = &mut ctx.accounts.config;
    config.apply(&params);
    emit!(ConfigUpdated { admin: config.admin, keeper_authority: config.keeper_authority });
    Ok(())
}

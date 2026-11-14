use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::GuardError;
use crate::events::AssetEnabledSet;
use crate::state::{Asset, Config};

#[derive(Accounts)]
pub struct SetAssetEnabled<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ GuardError::NotAdmin)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [ASSET_SEED, asset.mint.as_ref()], bump = asset.bump,
        constraint = asset.version == ACCOUNT_VERSION @ GuardError::UnsupportedVersion)]
    pub asset: Box<Account<'info, Asset>>,
}

pub fn set_asset_enabled_handler(ctx: Context<SetAssetEnabled>, enabled: bool) -> Result<()> {
    ctx.accounts.asset.enabled = enabled;
    emit!(AssetEnabledSet { asset: ctx.accounts.asset.key(), enabled });
    Ok(())
}

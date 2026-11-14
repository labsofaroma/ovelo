use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};

use crate::constants::*;
use crate::errors::GuardError;
use crate::events::AssetRegistered;
use crate::state::{Asset, Config};
use crate::token_policy::inspect_mint;

#[derive(Accounts)]
pub struct RegisterAsset<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ GuardError::NotAdmin)]
    pub config: Box<Account<'info, Config>>,
    #[account(init, payer = admin, space = 8 + Asset::INIT_SPACE, seeds = [ASSET_SEED, mint.key().as_ref()], bump)]
    pub asset: Box<Account<'info, Asset>>,
    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// Registers a mint after the Token-2022 policy (`token_policy`). In the devnet build the mint
/// authority must be this asset's `["mock_mint", mint]` PDA, so only the program can mint it.
pub fn register_asset_handler(ctx: Context<RegisterAsset>, pyth_feed_id: [u8; 32]) -> Result<()> {
    require!(pyth_feed_id != [0u8; 32], GuardError::PriceFeedMismatch);
    let mint_info = ctx.accounts.mint.to_account_info();
    let token_program = ctx.accounts.token_program.key();
    let facts = inspect_mint(&mint_info.try_borrow_data()?, &token_program, &ctx.accounts.config)?;

    #[cfg(feature = "devnet-mock")]
    let mock_mint_bump = {
        let (pda, bump) =
            Pubkey::find_program_address(&[MOCK_MINT_SEED, mint_info.key.as_ref()], ctx.program_id);
        require!(facts.mint_authority == Some(pda), GuardError::MockMintAuthorityMismatch);
        bump
    };
    #[cfg(not(feature = "devnet-mock"))]
    let mock_mint_bump = 0u8;

    let asset = &mut ctx.accounts.asset;
    asset.version = ACCOUNT_VERSION;
    asset.mint = mint_info.key();
    asset.token_program = token_program;
    asset.pyth_feed_id = pyth_feed_id;
    asset.decimals = facts.decimals;
    asset.enabled = true;
    asset.bump = ctx.bumps.asset;
    asset.extensions = facts.extensions;
    asset.scaled_ui_amount = facts.scaled.is_some();
    asset.mock_mint_bump = mock_mint_bump;
    asset.registered_at = Clock::get()?.unix_timestamp;
    asset.reserved = [0; 64];
    emit!(AssetRegistered {
        asset: asset.key(),
        mint: asset.mint,
        token_program,
        pyth_feed_id,
        decimals: asset.decimals,
        extensions: asset.extensions,
        scaled_ui_amount: asset.scaled_ui_amount,
    });
    Ok(())
}

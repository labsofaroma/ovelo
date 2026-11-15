use anchor_lang::prelude::*;

/// PDA `["asset", mint]`. Only registered and enabled assets can be plan outputs.
#[account]
#[derive(InitSpace, Debug)]
pub struct Asset {
    pub version: u8,
    pub mint: Pubkey,
    /// SPL Token or Token-2022.
    pub token_program: Pubkey,
    /// Pyth feed for the underlying equity (price per share).
    pub pyth_feed_id: [u8; 32],
    pub decimals: u8,
    pub enabled: bool,
    pub bump: u8,
    /// Token-2022 extensions present at registration: bit `n` set = `ExtensionType` `n`.
    pub extensions: u64,
    /// The mint has ScaledUiAmount: one token is `multiplier` shares, applied at execution.
    pub scaled_ui_amount: bool,
    /// Bump of `["mock_mint", mint]` in the devnet build (0 in the mainnet build).
    pub mock_mint_bump: u8,
    pub registered_at: i64,
    pub reserved: [u8; 64],
}

pub const ASSET_SPACE: usize = 1 + 32 + 32 + 32 + 1 + 1 + 1 + 8 + 1 + 1 + 8 + 64;

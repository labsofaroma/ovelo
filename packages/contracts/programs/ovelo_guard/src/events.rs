use anchor_lang::prelude::*;

#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
    pub keeper_authority: Option<Pubkey>,
}

#[event]
pub struct ConfigUpdated {
    pub admin: Pubkey,
    pub keeper_authority: Option<Pubkey>,
}

#[event]
pub struct ProtocolPauseSet {
    pub paused: bool,
}

#[event]
pub struct AssetRegistered {
    pub asset: Pubkey,
    pub mint: Pubkey,
    pub token_program: Pubkey,
    pub pyth_feed_id: [u8; 32],
    pub decimals: u8,
    pub extensions: u64,
    pub scaled_ui_amount: bool,
}

#[event]
pub struct AssetEnabledSet {
    pub asset: Pubkey,
    pub enabled: bool,
}

#[event]
pub struct PlanCreated {
    pub plan: Pubkey,
    pub owner: Pubkey,
    pub funding_mint: Pubkey,
    pub nonce: u64,
    pub funding_amount: u64,
    pub period_seconds: u64,
    pub starts_at: i64,
    pub expires_at: i64,
    pub periods: u16,
    pub outputs: u8,
}

#[event]
pub struct PlanPauseSet {
    pub plan: Pubkey,
    pub owner: Pubkey,
    pub paused: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct LegExecuted {
    pub leg: u8,
    pub mint: Pubkey,
    /// Funding spent on this leg (after any protocol fee).
    pub amount_in: u64,
    pub fee: u64,
    pub amount_out: u64,
    pub min_out: u64,
    pub oracle_price: i64,
    pub oracle_expo: i32,
    pub oracle_publish_time: i64,
    /// Shares per token used for this leg, fixed point 10^12 (1.0 = 1_000_000_000_000).
    pub multiplier_fp: u128,
}

#[event]
pub struct InstallmentExecuted {
    pub plan: Pubkey,
    pub period: u16,
    pub legs: Vec<LegExecuted>,
    /// Periods newly marked skipped when this period started (only on its first leg).
    pub newly_skipped: u16,
    pub period_complete: bool,
}

#[event]
pub struct PlanClosed {
    pub plan: Pubkey,
    pub owner: Pubkey,
    /// Staging balance returned to the owner.
    pub returned_amount: u64,
    pub executed_periods: u16,
    pub skipped_periods: u16,
}

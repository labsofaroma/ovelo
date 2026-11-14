use crate::constants::*;
use anchor_lang::prelude::*;

/// PDA `["plan", owner, funding_mint, nonce_le_u64]` (CONTRACT-V1-SPEC §4). Every fixed-size
/// field comes before `outputs`, so each has a fixed offset (keeper `memcmp` filters).
#[account]
#[derive(InitSpace, Debug)]
pub struct Plan {
    pub version: u8,
    pub owner: Pubkey,
    pub funding_mint: Pubkey,
    pub nonce: u64,
    /// Per installment, raw units.
    pub funding_amount: u64,
    pub period_seconds: u64,
    pub starts_at: i64,
    /// End of the schedule: `starts_at + periods × period_seconds`.
    pub expires_at: i64,
    pub created_at: i64,
    pub periods: u16,
    pub executed_periods: u16,
    pub skipped_periods: u16,
    /// `NO_PERIOD` until the first execution.
    pub last_executed_period: u16,
    pub last_executed_at: i64,
    pub paused_by_owner: bool,
    /// Legs done in `in_progress_period` (multi-transaction execution).
    pub leg_bitmap: u32,
    pub subscription_authority: Pubkey,
    pub recurring_delegation: Pubkey,
    pub subscription_init_id: i64,
    pub bump: u8,
    pub funding_token_program: Pubkey,
    /// Snapshot of `Config.catch_up_window_periods` at creation (the delegation terms use it).
    pub catch_up_window_periods: u16,
    /// Period whose legs are in flight; `NO_PERIOD` when none.
    pub in_progress_period: u16,
    /// Staging balance before the in-flight period's pull.
    pub staging_start_balance: u64,
    #[max_len(20)]
    pub outputs: Vec<Output>,
    pub reserved: [u8; 96],
}

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy, Debug, PartialEq, Eq)]
pub struct Output {
    pub mint: Pubkey,
    pub weight_bps: u16,
    pub max_slippage_bps: u16,
}

pub const OUTPUT_SPACE: usize = 32 + 2 + 2;
pub const PLAN_SPACE: usize = 1 + 32 + 32 + 8 * 6 + 2 * 4 + 8 + 1 + 4 + 32 + 32 + 8 + 1
    + 32 + 2 + 2 + 8
    + 4 + OUTPUT_SPACE * MAX_OUTPUTS
    + 96;

impl Plan {
    pub fn all_legs_mask(&self) -> u32 {
        // outputs.len() <= 20, so the shift never overflows.
        (1u32 << self.outputs.len()) - 1
    }

    pub fn weights(&self) -> Vec<u16> {
        self.outputs.iter().map(|o| o.weight_bps).collect()
    }
}

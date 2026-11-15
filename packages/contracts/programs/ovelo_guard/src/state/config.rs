use crate::constants::*;
use anchor_lang::prelude::*;

/// PDA `["config"]`, one per program (CONTRACT-V1-SPEC §4). Fields after `bump` are the v1
/// additions the M6 decisions need (oracle confidence, devnet treasury, Token-2022 allow-lists);
/// `reserved` stays last for later versions.
#[account]
#[derive(InitSpace, Debug)]
pub struct Config {
    pub version: u8,
    /// Squads multisig vault on mainnet; the owner's deployer on devnet.
    pub admin: Pubkey,
    /// `None` = anyone can execute installments.
    pub keeper_authority: Option<Pubkey>,
    pub paused: bool,
    /// Unused slots are `Pubkey::default()`.
    pub allowed_funding_mints: [Pubkey; MAX_FUNDING_MINTS],
    /// Global ceiling for every output's slippage.
    pub max_slippage_bps: u16,
    pub max_oracle_staleness_s: u32,
    pub catch_up_window_periods: u16,
    /// 0 at launch.
    pub protocol_fee_bps: u16,
    pub fee_recipient: Pubkey,
    /// Launch cap per installment, raw funding units.
    pub max_installment_amount: u64,
    pub bump: u8,
    /// Maximum `conf / price`, in bps.
    pub max_confidence_bps: u16,
    /// Owner of the token accounts that receive spent funding in the devnet build.
    pub treasury: Pubkey,
    /// Accepted mint freeze authorities and Pausable authorities.
    pub allowed_freeze_authorities: [Pubkey; MAX_ALLOW_LIST],
    /// Accepted permanent delegates and confidential-transfer authorities (issuer keys).
    pub allowed_permanent_delegates: [Pubkey; MAX_ALLOW_LIST],
    /// Accepted Token-2022 transfer-hook programs.
    pub allowed_transfer_hook_programs: [Pubkey; MAX_ALLOW_LIST],
    pub reserved: [u8; 128],
}

/// Explicit size (without the 8-byte discriminator); `tests::sizes` checks it equals `INIT_SPACE`.
pub const CONFIG_SPACE: usize = 1 + 32 + 33 + 1 + 32 * MAX_FUNDING_MINTS + 2 + 4 + 2 + 2 + 32 + 8 + 1
    + 2 + 32 + 32 * MAX_ALLOW_LIST * 3 + 128;

/// Settable config values (`initialize_config`, `update_config`).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct ConfigParams {
    pub admin: Pubkey,
    pub keeper_authority: Option<Pubkey>,
    pub allowed_funding_mints: [Pubkey; MAX_FUNDING_MINTS],
    pub max_slippage_bps: u16,
    pub max_oracle_staleness_s: u32,
    pub catch_up_window_periods: u16,
    pub protocol_fee_bps: u16,
    pub fee_recipient: Pubkey,
    pub max_installment_amount: u64,
    pub max_confidence_bps: u16,
    pub treasury: Pubkey,
    pub allowed_freeze_authorities: [Pubkey; MAX_ALLOW_LIST],
    pub allowed_permanent_delegates: [Pubkey; MAX_ALLOW_LIST],
    pub allowed_transfer_hook_programs: [Pubkey; MAX_ALLOW_LIST],
}

fn distinct_entries(list: &[Pubkey]) -> bool {
    let set: Vec<&Pubkey> = list.iter().filter(|k| **k != Pubkey::default()).collect();
    set.iter().enumerate().all(|(i, a)| set[i + 1..].iter().all(|b| a != b))
}

impl ConfigParams {
    /// Pure validation, unit-tested.
    pub fn is_valid(&self) -> bool {
        let funding_count = self
            .allowed_funding_mints
            .iter()
            .filter(|k| **k != Pubkey::default())
            .count();
        self.admin != Pubkey::default()
            && self.keeper_authority != Some(Pubkey::default())
            && funding_count >= 1
            && distinct_entries(&self.allowed_funding_mints)
            && distinct_entries(&self.allowed_freeze_authorities)
            && distinct_entries(&self.allowed_permanent_delegates)
            && distinct_entries(&self.allowed_transfer_hook_programs)
            && self.max_slippage_bps <= MAX_SLIPPAGE_CEILING_BPS
            && (1..=MAX_ORACLE_STALENESS_CEILING_S).contains(&self.max_oracle_staleness_s)
            && self.catch_up_window_periods <= MAX_CATCH_UP_WINDOW
            && self.protocol_fee_bps <= MAX_PROTOCOL_FEE_BPS
            && (self.protocol_fee_bps == 0 || self.fee_recipient != Pubkey::default())
            && self.max_installment_amount > 0
            && (1..=MAX_CONFIDENCE_CEILING_BPS).contains(&self.max_confidence_bps)
            && self.treasury != Pubkey::default()
    }
}

impl Config {
    pub fn apply(&mut self, p: &ConfigParams) {
        self.admin = p.admin;
        self.keeper_authority = p.keeper_authority;
        self.allowed_funding_mints = p.allowed_funding_mints;
        self.max_slippage_bps = p.max_slippage_bps;
        self.max_oracle_staleness_s = p.max_oracle_staleness_s;
        self.catch_up_window_periods = p.catch_up_window_periods;
        self.protocol_fee_bps = p.protocol_fee_bps;
        self.fee_recipient = p.fee_recipient;
        self.max_installment_amount = p.max_installment_amount;
        self.max_confidence_bps = p.max_confidence_bps;
        self.treasury = p.treasury;
        self.allowed_freeze_authorities = p.allowed_freeze_authorities;
        self.allowed_permanent_delegates = p.allowed_permanent_delegates;
        self.allowed_transfer_hook_programs = p.allowed_transfer_hook_programs;
    }

    pub fn is_funding_mint(&self, mint: &Pubkey) -> bool {
        *mint != Pubkey::default() && self.allowed_funding_mints.contains(mint)
    }
}

/// `true` when `key` is a non-default member of `list`.
pub fn listed(list: &[Pubkey], key: &Pubkey) -> bool {
    *key != Pubkey::default() && list.contains(key)
}

//! Seeds and limits. Every limit that bounds user funds lives here.

pub const CONFIG_SEED: &[u8] = b"config";
pub const ASSET_SEED: &[u8] = b"asset";
pub const PLAN_SEED: &[u8] = b"plan";
/// Devnet build only: per-asset mint authority PDA `["mock_mint", mint]`.
pub const MOCK_MINT_SEED: &[u8] = b"mock_mint";

/// Layout version of every v1 account.
pub const ACCOUNT_VERSION: u8 = 1;

pub const MAX_OUTPUTS: usize = 20;
pub const MAX_FUNDING_MINTS: usize = 4;
/// Length of each Token-2022 allow-list in `Config`.
pub const MAX_ALLOW_LIST: usize = 4;

pub const TOTAL_WEIGHT_BPS: u16 = 10_000;
pub const BPS_DENOMINATOR: u128 = 10_000;
/// `Plan.last_executed_period` / `in_progress_period` before any period.
pub const NO_PERIOD: u16 = u16::MAX;

/// Shortest period. The devnet build allows short periods so a local validator can run
/// several periods in minutes; the mainnet build requires at least one hour.
#[cfg(feature = "devnet-mock")]
pub const MIN_PERIOD_SECONDS: u64 = 10;
#[cfg(not(feature = "devnet-mock"))]
pub const MIN_PERIOD_SECONDS: u64 = 3_600;
/// Longest schedule (periods × period_seconds), one year plus a day.
pub const MAX_DURATION_SECONDS: u64 = 366 * 24 * 60 * 60;
/// A plan may start at most this far in the future.
pub const MAX_START_DELAY_SECONDS: i64 = 30 * 24 * 60 * 60;

// Config bounds (initialize_config / update_config).
pub const MAX_SLIPPAGE_CEILING_BPS: u16 = 2_000;
pub const MAX_ORACLE_STALENESS_CEILING_S: u32 = 3_600;
pub const MAX_CATCH_UP_WINDOW: u16 = 4;
pub const MAX_PROTOCOL_FEE_BPS: u16 = 100;
pub const MAX_CONFIDENCE_CEILING_BPS: u16 = 1_000;

/// Fixed-point scale for the Token-2022 ScaledUiAmount multiplier: 10^12.
pub const MULTIPLIER_SCALE_DECIMALS: u32 = 12;
/// Accepted multiplier range, in fixed point: [10^-6, 10^6].
pub const MIN_MULTIPLIER_FP: u128 = 1_000_000;
pub const MAX_MULTIPLIER_FP: u128 = 1_000_000_000_000_000_000;

/// Remaining accounts per leg in `execute_installment`:
/// `[asset, output_mint, owner_output_token, price_update, mock_mint_authority, output_token_program]`.
pub const ACCOUNTS_PER_LEG: usize = 6;

/// Mainnet build: the program-wide PDA `["swap_authority"]` that signs every Jupiter CPI. It owns
/// one funding-mint account and one transit account per output mint; each must end every leg at
/// the balance it started with (M8, REWRITE-PLAN M8 decision 4).
pub const SWAP_AUTHORITY_SEED: &[u8] = b"swap_authority";
/// Mainnet build: a price update may be at most this old, whatever `max_oracle_staleness_s` allows
/// (M8 decision 1: bounds which update in the staleness window an executor can choose).
pub const MAINNET_MAX_PRICE_AGE_S: u32 = 20;
/// `execute_installment_routed`: remaining accounts per leg before its Jupiter accounts:
/// `[asset, price_update]`.
pub const ROUTED_FIXED_ACCOUNTS_PER_LEG: usize = 2;

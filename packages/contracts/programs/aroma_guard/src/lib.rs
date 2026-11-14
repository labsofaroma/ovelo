//! Aroma Guard v1 (CONTRACT-V1-SPEC). Entrypoints only; logic lives in `instructions/`.
#![deny(clippy::all)]
// Anchor's `Result` carries a large error type; the size is upstream's, not ours.
#![allow(clippy::result_large_err)]

use anchor_lang::prelude::*;

declare_id!("FYrrfhrysaGUwCNyTggqyKmTWqpg3vph8gzmSWt7QtTU");

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod integrations;
pub mod math;
pub mod state;
#[cfg(not(feature = "devnet-mock"))]
pub mod swap_math;
pub mod token_policy;

#[cfg(test)]
mod tests;

use instructions::*;
use state::ConfigParams;

#[cfg(not(feature = "no-entrypoint"))]
solana_security_txt::security_txt! {
    name: "Aroma Guard v1",
    project_url: "https://github.com/aromalabs",
    contacts: "link:https://github.com/aromalabs/aroma/security/advisories/new",
    policy: "https://github.com/aromalabs/aroma/blob/main/SECURITY.md",
    preferred_languages: "en",
    source_code: "https://github.com/aromalabs/aroma",
    auditors: "None yet (external audit is milestone M10)"
}

#[program]
pub mod aroma_guard {
    use super::*;

    /// Once, signed by the program's upgrade authority.
    pub fn initialize_config(ctx: Context<InitializeConfig>, params: ConfigParams) -> Result<()> {
        initialize_config_handler(ctx, params)
    }

    pub fn update_config(ctx: Context<AdminConfig>, params: ConfigParams) -> Result<()> {
        update_config_handler(ctx, params)
    }

    pub fn set_paused(ctx: Context<AdminConfig>, paused: bool) -> Result<()> {
        set_paused_handler(ctx, paused)
    }

    pub fn register_asset(ctx: Context<RegisterAsset>, pyth_feed_id: [u8; 32]) -> Result<()> {
        register_asset_handler(ctx, pyth_feed_id)
    }

    pub fn set_asset_enabled(ctx: Context<SetAssetEnabled>, enabled: bool) -> Result<()> {
        set_asset_enabled_handler(ctx, enabled)
    }

    pub fn create_plan<'info>(ctx: Context<'info, CreatePlan<'info>>, args: CreatePlanArgs) -> Result<()> {
        create_plan_handler(ctx, args)
    }

    pub fn pause_plan(ctx: Context<OwnerPlan>) -> Result<()> {
        set_plan_paused(ctx, true)
    }

    pub fn resume_plan(ctx: Context<OwnerPlan>) -> Result<()> {
        set_plan_paused(ctx, false)
    }

    pub fn execute_installment<'info>(
        ctx: Context<'info, ExecuteInstallment<'info>>,
        period: u16,
        leg_mask: u32,
    ) -> Result<()> {
        execute_installment_handler(ctx, period, leg_mask)
    }

    /// Mainnet build: one Jupiter `route_v2` swap per leg, keeper-only (M8). Devnet-mock build:
    /// refused (`RoutedExecutionUnavailable`).
    pub fn execute_installment_routed<'info>(
        ctx: Context<'info, ExecuteInstallment<'info>>,
        period: u16,
        leg_mask: u32,
        routes: Vec<RouteLeg>,
    ) -> Result<()> {
        execute_installment_routed_handler(ctx, period, leg_mask, routes)
    }

    pub fn close_plan(ctx: Context<ClosePlan>) -> Result<()> {
        close_plan_handler(ctx)
    }
}

//! One mainnet leg (CONTRACT-V1-SPEC §6, step 4): oracle floor, Jupiter `route_v2` CPI, balance
//! verification. Remaining accounts for the leg: `[asset, price_update, …route]`, where `route` is
//! the Jupiter instruction's account list in Jupiter's order (fixed prefix, then hop accounts).
//!
//! Funds path: staging --(plan PDA signs)--> fee account (fee > 0) and the swap authority's funding
//! account (`amount_in`) --(swap authority signs the CPI)--> pools --> the swap authority's transit
//! account for the output mint --> `destination_token_account` = the owner's ATA. The plan PDA,
//! which is also the Subscriptions delegatee, never signs anything a route can reach.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use anchor_spl::token_2022::spl_token_2022;

use super::common::{move_funding, reload_amount};
use super::ExecuteInstallment;
use crate::constants::*;
use crate::errors::GuardError;
use crate::events::LegExecuted;
use crate::integrations::jupiter::{
    check_route_terms, parse_route_v2, prefix, route_instruction, JUPITER_EVENT_AUTHORITY, JUPITER_V6_PROGRAM_ID,
};
use crate::integrations::pyth::read_price;
use crate::math::leg_amount;
use crate::state::{Asset, Output};
use crate::swap_math::{effective_max_price_age, leg_terms, verify_swap, SwapBalances};
use crate::token_policy::{inspect_mint, read_token_account, TokenAccountFacts};

/// The program-wide signer of Jupiter CPIs, `["swap_authority"]`.
pub struct SwapSigner {
    pub key: Pubkey,
    pub bump: u8,
}

impl SwapSigner {
    pub fn find(program_id: &Pubkey) -> Self {
        let (key, bump) = Pubkey::find_program_address(&[SWAP_AUTHORITY_SEED], program_id);
        Self { key, bump }
    }
}

const TOKEN_ACCOUNT_LEN: usize = 165;
/// Token-2022 `AccountType::Account`, the byte after the base layout of an extended account.
const ACCOUNT_TYPE_ACCOUNT: u8 = 2;

/// SPL Token or Token-2022 **token account** (not a mint or multisig), from owner and layout.
fn token_account_authority(info: &AccountInfo) -> Option<Pubkey> {
    let classic = *info.owner == anchor_spl::token::ID;
    if !classic && *info.owner != spl_token_2022::ID {
        return None;
    }
    let data = info.try_borrow_data().ok()?;
    let is_account = data.len() == TOKEN_ACCOUNT_LEN
        || (!classic && data.len() > TOKEN_ACCOUNT_LEN && data[TOKEN_ACCOUNT_LEN] == ACCOUNT_TYPE_ACCOUNT);
    if !is_account {
        return None;
    }
    Pubkey::try_from(&data[32..64]).ok()
}

/// Refuses a route that names any account of the plan or the protocol, any token account the plan
/// owns, or a writable swap-authority token account other than this leg's source and transit.
fn check_route_accounts(ctx: &Context<ExecuteInstallment>, route: &[AccountInfo], swap: &Pubkey) -> Result<()> {
    let a = &ctx.accounts;
    let plan = a.plan.key();
    let mut forbidden = vec![
        plan,
        a.config.key(),
        a.staging.key(),
        a.owner_funding_token.key(),
        a.treasury_token.key(),
        a.subscription_authority.key(),
        a.recurring_delegation.key(),
        a.subscriptions_event_authority.key(),
        a.subscriptions_program.key(),
        crate::ID,
    ];
    if let Some(fee) = &a.fee_token {
        forbidden.push(fee.key());
    }
    let (source, transit) = (route[prefix::SOURCE].key, route[prefix::TRANSIT].key);
    for info in route {
        require!(!forbidden.contains(info.key), GuardError::RouteAccountForbidden);
        if !info.is_writable {
            continue;
        }
        if let Some(authority) = token_account_authority(info) {
            require!(authority != plan, GuardError::RouteAccountForbidden);
            require!(
                authority != *swap || info.key == source || info.key == transit,
                GuardError::RouteAccountForbidden
            );
        }
    }
    Ok(())
}

fn expect_account(info: &AccountInfo, owner: &Pubkey, mint: &Pubkey, e: GuardError) -> Result<TokenAccountFacts> {
    let facts = read_token_account(info).map_err(|_| e)?;
    if facts.owner != *owner || facts.mint != *mint {
        return Err(e.into());
    }
    Ok(facts)
}

pub fn execute_routed_leg<'info>(
    ctx: &Context<'info, ExecuteInstallment<'info>>,
    leg: usize,
    accounts: &'info [AccountInfo<'info>],
    data: &[u8],
    now: i64,
    swap: &SwapSigner,
) -> Result<LegExecuted> {
    let a = &ctx.accounts;
    let (config, plan) = (&a.config, &a.plan);
    let output: Output = plan.outputs[leg];
    let [asset_info, price_info, route @ ..] = accounts else {
        return err!(GuardError::InvalidRemainingAccounts);
    };
    require!(route.len() > prefix::PREFIX_LEN, GuardError::UnsupportedRoute);

    // Asset: this program's PDA for the output mint, current version, enabled.
    let asset: Account<Asset> = Account::try_from(asset_info).map_err(|_| GuardError::AssetMismatch)?;
    let asset_pda = Pubkey::create_program_address(&[ASSET_SEED, output.mint.as_ref(), &[asset.bump]], ctx.program_id)
        .map_err(|_| GuardError::AssetMismatch)?;
    require_keys_eq!(asset_info.key(), asset_pda, GuardError::AssetMismatch);
    require!(asset.version == ACCOUNT_VERSION && asset.mint == output.mint, GuardError::AssetMismatch);
    require!(asset.enabled, GuardError::AssetDisabled);

    // Route prefix: Jupiter itself, its event authority, our swap authority (read-only signer),
    // the plan's funding mint and program, the asset's mint and program.
    use prefix::*;
    require_keys_eq!(route[PROGRAM].key(), JUPITER_V6_PROGRAM_ID, GuardError::UnsupportedRoute);
    require!(route[PROGRAM].executable, GuardError::UnsupportedRoute);
    require_keys_eq!(route[EVENT_AUTHORITY].key(), JUPITER_EVENT_AUTHORITY, GuardError::RouteAccountMismatch);
    require_keys_eq!(route[AUTHORITY].key(), swap.key, GuardError::RouteAccountMismatch);
    require!(!route[AUTHORITY].is_writable, GuardError::RouteAccountMismatch);
    require_keys_eq!(route[SOURCE_MINT].key(), plan.funding_mint, GuardError::RouteAccountMismatch);
    require_keys_eq!(route[SOURCE_TOKEN_PROGRAM].key(), a.funding_token_program.key(), GuardError::RouteAccountMismatch);
    let mint_info = &route[DESTINATION_MINT];
    require_keys_eq!(mint_info.key(), output.mint, GuardError::AssetMismatch);
    require_keys_eq!(*mint_info.owner, asset.token_program, GuardError::UnsupportedTokenProgram);
    require_keys_eq!(route[DESTINATION_TOKEN_PROGRAM].key(), asset.token_program, GuardError::UnsupportedTokenProgram);
    require!(route[DESTINATION_TOKEN_PROGRAM].executable, GuardError::UnsupportedTokenProgram);

    // Source and transit: the swap authority's associated accounts. Destination: exactly the
    // owner's associated token account for the output mint, checked before the CPI.
    let funding_program = a.funding_token_program.key();
    let source_ata = get_associated_token_address_with_program_id(&swap.key, &plan.funding_mint, &funding_program);
    let transit_ata = get_associated_token_address_with_program_id(&swap.key, &output.mint, &asset.token_program);
    let owner_ata = get_associated_token_address_with_program_id(&plan.owner, &output.mint, &asset.token_program);
    require_keys_eq!(route[SOURCE].key(), source_ata, GuardError::RouteAccountMismatch);
    require_keys_eq!(route[TRANSIT].key(), transit_ata, GuardError::RouteAccountMismatch);
    require_keys_eq!(route[DESTINATION].key(), owner_ata, GuardError::WrongDestination);
    let destination = expect_account(&route[DESTINATION], &plan.owner, &output.mint, GuardError::WrongDestination)?;
    let source = expect_account(&route[SOURCE], &swap.key, &plan.funding_mint, GuardError::RouteAccountMismatch)?;
    let transit = expect_account(&route[TRANSIT], &swap.key, &output.mint, GuardError::RouteAccountMismatch)?;
    check_route_accounts(ctx, route, &swap.key)?;

    // The live mint still passes the Token-2022 policy, has its registered decimals, is not paused.
    let facts = inspect_mint(&mint_info.try_borrow_data()?, &asset.token_program, config)?;
    require!(facts.decimals == asset.decimals, GuardError::DecimalsChanged);
    require!(!facts.paused, GuardError::MintPaused);

    // Oracle floor on the leg's full funding (decision 1 bounds the price age).
    let price = read_price(
        price_info,
        &asset.pyth_feed_id,
        now,
        effective_max_price_age(config.max_oracle_staleness_s),
        config.max_confidence_bps,
    )?;
    let multiplier_fp = facts.multiplier_fp(now)?;
    let t = leg_terms(
        leg_amount(plan.funding_amount, &plan.weights(), leg)?,
        config.protocol_fee_bps,
        a.funding_mint.decimals,
        asset.decimals,
        price.price,
        price.expo,
        multiplier_fp,
        output.max_slippage_bps,
    )?;
    check_route_terms(&parse_route_v2(data)?, t.amount_in)?;

    // Fund the swap (plan PDA signs), then the CPI (swap authority signs).
    let staging_before = reload_amount(&a.staging.to_account_info())?;
    if t.fee > 0 {
        let fee_token = a.fee_token.as_ref().ok_or(GuardError::InvalidTokenAccount)?;
        move_funding(ctx, fee_token.to_account_info(), t.fee)?;
    }
    move_funding(ctx, route[SOURCE].clone(), t.amount_in)?;
    invoke_signed(
        &route_instruction(route, data.to_vec(), &swap.key),
        route,
        &[&[SWAP_AUTHORITY_SEED, &[swap.bump]]],
    )?;

    let received = verify_swap(
        &SwapBalances {
            staging_before,
            staging_after: reload_amount(&a.staging.to_account_info())?,
            source_before: source.amount,
            source_after: reload_amount(&route[SOURCE])?,
            transit_before: transit.amount,
            transit_after: reload_amount(&route[TRANSIT])?,
            destination_before: destination.amount,
            destination_after: reload_amount(&route[DESTINATION])?,
        },
        &t,
    )?;
    Ok(LegExecuted {
        leg: u8::try_from(leg).map_err(|_| GuardError::InvalidLegMask)?,
        mint: output.mint,
        amount_in: t.amount_in,
        fee: t.fee,
        amount_out: received,
        min_out: t.min_out,
        oracle_price: price.price,
        oracle_expo: price.expo,
        oracle_publish_time: price.publish_time,
        multiplier_fp,
    })
}

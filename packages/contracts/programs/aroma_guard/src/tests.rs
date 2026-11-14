//! Host unit tests for sizes and pure validation. Program behaviour is tested in LiteSVM
//! (`packages/contracts/tests/litesvm`).

use anchor_lang::prelude::*;
use anchor_lang::Space;

use crate::constants::*;
use crate::instructions::plan::create_plan::{validate_args, CreatePlanArgs};
use crate::state::*;

#[test]
fn sizes_are_explicit_and_match_init_space() {
    assert_eq!(Config::INIT_SPACE, CONFIG_SPACE);
    assert_eq!(Asset::INIT_SPACE, ASSET_SPACE);
    assert_eq!(Plan::INIT_SPACE, PLAN_SPACE);
    assert_eq!(Output::INIT_SPACE, OUTPUT_SPACE);
    // Pinned numbers: a layout change must change these on purpose.
    assert_eq!(CONFIG_SPACE, 792);
    assert_eq!(ASSET_SPACE, 182);
    assert_eq!(PLAN_SPACE, 1_071);
}

type Mutation = Box<dyn Fn(&mut ConfigParams)>;

fn params() -> ConfigParams {
    let k = |b: u8| Pubkey::new_from_array([b; 32]);
    let mut funding = [Pubkey::default(); MAX_FUNDING_MINTS];
    funding[0] = k(9);
    ConfigParams {
        admin: k(1),
        keeper_authority: Some(k(2)),
        allowed_funding_mints: funding,
        max_slippage_bps: 300,
        max_oracle_staleness_s: 60,
        catch_up_window_periods: 1,
        protocol_fee_bps: 0,
        fee_recipient: Pubkey::default(),
        max_installment_amount: 500_000_000,
        max_confidence_bps: 200,
        treasury: k(3),
        allowed_freeze_authorities: [Pubkey::default(); MAX_ALLOW_LIST],
        allowed_permanent_delegates: [Pubkey::default(); MAX_ALLOW_LIST],
        allowed_transfer_hook_programs: [Pubkey::default(); MAX_ALLOW_LIST],
    }
}

#[test]
fn config_params_are_bounded() {
    assert!(params().is_valid());
    let k = |b: u8| Pubkey::new_from_array([b; 32]);
    let cases: Vec<Mutation> = vec![
        Box::new(|p| p.admin = Pubkey::default()),
        Box::new(|p| p.keeper_authority = Some(Pubkey::default())),
        Box::new(|p| p.allowed_funding_mints = [Pubkey::default(); MAX_FUNDING_MINTS]),
        Box::new(move |p| p.allowed_funding_mints[1] = p.allowed_funding_mints[0]),
        Box::new(|p| p.max_slippage_bps = MAX_SLIPPAGE_CEILING_BPS + 1),
        Box::new(|p| p.max_oracle_staleness_s = 0),
        Box::new(|p| p.max_oracle_staleness_s = MAX_ORACLE_STALENESS_CEILING_S + 1),
        Box::new(|p| p.catch_up_window_periods = MAX_CATCH_UP_WINDOW + 1),
        Box::new(|p| p.protocol_fee_bps = MAX_PROTOCOL_FEE_BPS + 1),
        Box::new(|p| p.protocol_fee_bps = 10), // fee without a recipient
        Box::new(|p| p.max_installment_amount = 0),
        Box::new(|p| p.max_confidence_bps = 0),
        Box::new(|p| p.treasury = Pubkey::default()),
        Box::new(move |p| p.allowed_freeze_authorities = [k(5), k(5), Pubkey::default(), Pubkey::default()]),
    ];
    for (i, mutate) in cases.iter().enumerate() {
        let mut p = params();
        mutate(&mut p);
        assert!(!p.is_valid(), "case {i} should be invalid");
    }
    let mut anyone = params();
    anyone.keeper_authority = None;
    assert!(anyone.is_valid(), "None = anyone can execute");
    let mut fee = params();
    fee.protocol_fee_bps = 25;
    fee.fee_recipient = k(7);
    assert!(fee.is_valid(), "non-zero fee with a recipient");
}

fn config() -> Config {
    let p = params();
    let mut c = Config {
        version: 1,
        admin: Pubkey::default(),
        keeper_authority: None,
        paused: false,
        allowed_funding_mints: [Pubkey::default(); MAX_FUNDING_MINTS],
        max_slippage_bps: 0,
        max_oracle_staleness_s: 0,
        catch_up_window_periods: 0,
        protocol_fee_bps: 0,
        fee_recipient: Pubkey::default(),
        max_installment_amount: 0,
        bump: 255,
        max_confidence_bps: 0,
        treasury: Pubkey::default(),
        allowed_freeze_authorities: [Pubkey::default(); MAX_ALLOW_LIST],
        allowed_permanent_delegates: [Pubkey::default(); MAX_ALLOW_LIST],
        allowed_transfer_hook_programs: [Pubkey::default(); MAX_ALLOW_LIST],
        reserved: [0; 128],
    };
    c.apply(&p);
    c
}

fn args(outputs: Vec<(u8, u16, u16)>) -> CreatePlanArgs {
    CreatePlanArgs {
        nonce: 1,
        funding_amount: 1_000_000,
        period_seconds: 86_400,
        starts_at: 1_000,
        periods: 4,
        outputs: outputs
            .into_iter()
            .map(|(b, weight_bps, max_slippage_bps)| Output {
                mint: Pubkey::new_from_array([b; 32]),
                weight_bps,
                max_slippage_bps,
            })
            .collect(),
    }
}

#[test]
fn create_plan_arguments_follow_spec_section_5() {
    let c = config();
    let funding = Pubkey::new_from_array([9; 32]);
    let ok = args(vec![(20, 5_000, 100), (21, 5_000, 300)]);
    assert_eq!(validate_args(&ok, &c, &funding, 1_000).unwrap(), 1_000 + 4 * 86_400);

    let err = |a: &CreatePlanArgs, mint: &Pubkey, now: i64| validate_args(a, &c, mint, now).unwrap_err();
    let code = |e: anchor_lang::error::Error| match e {
        anchor_lang::error::Error::AnchorError(a) => a.error_name.clone(),
        other => format!("{other:?}"),
    };
    // Wrong funding mint.
    assert_eq!(code(err(&ok, &Pubkey::new_unique(), 1_000)), "FundingMintNotAllowed");
    // Weights ≠ 10,000.
    assert_eq!(code(err(&args(vec![(20, 5_000, 0), (21, 4_999, 0)]), &funding, 1_000)), "InvalidWeights");
    assert_eq!(code(err(&args(vec![(20, 0, 0), (21, 10_000, 0)]), &funding, 1_000)), "InvalidWeights");
    // Slippage above the cap.
    assert_eq!(code(err(&args(vec![(20, 10_000, 301)]), &funding, 1_000)), "SlippageAboveCap");
    // Duplicate output, output = funding mint, empty, 21 outputs.
    assert_eq!(code(err(&args(vec![(20, 5_000, 0), (20, 5_000, 0)]), &funding, 1_000)), "InvalidOutputs");
    assert_eq!(code(err(&args(vec![(9, 10_000, 0)]), &funding, 1_000)), "InvalidOutputs");
    assert_eq!(code(err(&args(vec![]), &funding, 1_000)), "InvalidOutputs");
    let many: Vec<(u8, u16, u16)> = (0..21).map(|i| (30 + i as u8, if i == 0 { 8_000 } else { 100 }, 0)).collect();
    assert_eq!(code(err(&args(many), &funding, 1_000)), "InvalidOutputs");
    // Amount over the launch cap, zero amount, a leg that would receive nothing.
    let mut over = ok.clone();
    over.funding_amount = 500_000_001;
    assert_eq!(code(err(&over, &funding, 1_000)), "AmountAboveCap");
    let mut zero = ok.clone();
    zero.funding_amount = 0;
    assert_eq!(code(err(&zero, &funding, 1_000)), "InvalidSchedule");
    let mut dust = args(vec![(20, 1, 0), (21, 9_999, 0)]); // leg 0: floor(9,999 × 1 / 10,000) = 0
    dust.funding_amount = 9_999;
    assert_eq!(code(err(&dust, &funding, 1_000)), "InvalidWeights");
    // Schedule: too short, too long, starts too early or too late.
    let mut short = ok.clone();
    short.period_seconds = MIN_PERIOD_SECONDS - 1;
    assert_eq!(code(err(&short, &funding, 1_000)), "InvalidSchedule");
    let mut long = ok.clone();
    long.periods = 400;
    assert_eq!(code(err(&long, &funding, 1_000)), "InvalidSchedule");
    assert_eq!(code(err(&ok, &funding, 1_000 + 121)), "InvalidSchedule");
    assert_eq!(code(err(&ok, &funding, 1_000 - MAX_START_DELAY_SECONDS - 1)), "InvalidSchedule");
}

#[test]
fn twenty_outputs_fit_and_the_full_leg_mask_is_twenty_bits() {
    let outputs: Vec<(u8, u16, u16)> = (0..20).map(|i| (30 + i as u8, 500, 0)).collect();
    let c = config();
    let funding = Pubkey::new_from_array([9; 32]);
    assert!(validate_args(&args(outputs.clone()), &c, &funding, 1_000).is_ok());
    let plan_outputs: Vec<Output> = args(outputs).outputs;
    assert_eq!((1u32 << plan_outputs.len()) - 1, 0x000F_FFFF);
}

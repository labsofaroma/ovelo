use super::*;
use crate::constants::*;
use crate::math::{leg_amount, runnable_period, UNIT_MULTIPLIER_FP};

fn terms(leg_funding: u64, fee_bps: u16, slippage: u16) -> LegTerms {
    // $200.00000 per share, 6 dp funding, 8 dp output, multiplier 1.
    leg_terms(leg_funding, fee_bps, 6, 8, 20_000_000, -5, UNIT_MULTIPLIER_FP, slippage).unwrap()
}

fn balances(t: &LegTerms, consumed: u64, received: u64) -> SwapBalances {
    SwapBalances {
        staging_before: 100_000_000,
        staging_after: 100_000_000 - t.leg_funding,
        source_before: 5,
        source_after: 5 + t.amount_in - consumed,
        transit_before: 7,
        transit_after: 7,
        destination_before: 1_000,
        destination_after: 1_000 + received,
    }
}

#[test]
fn the_price_bound_is_the_tighter_of_config_and_the_mainnet_cap() {
    assert_eq!(effective_max_price_age(60), MAINNET_MAX_PRICE_AGE_S);
    assert_eq!(effective_max_price_age(5), 5);
}

#[test]
fn the_floor_is_on_the_full_leg_funding_so_a_fee_never_lowers_it() {
    let no_fee = terms(30_000_000, 0, 100);
    let fee = terms(30_000_000, 25, 100);
    // $30 at $200 → 0.15 shares; floor 1% below.
    assert_eq!((no_fee.expected_out, no_fee.min_out), (15_000_000, 14_850_000));
    assert_eq!((fee.fee, fee.amount_in), (75_000, 29_925_000));
    assert_eq!((fee.expected_out, fee.min_out), (no_fee.expected_out, no_fee.min_out));
}

#[test]
fn accepts_exact_spend_and_delivery_at_or_above_the_floor() {
    let t = terms(30_000_000, 0, 100);
    assert_eq!(verify_swap(&balances(&t, t.amount_in, t.min_out), &t), Ok(t.min_out));
    assert_eq!(verify_swap(&balances(&t, t.amount_in, t.min_out - 1), &t), Err(GuardError::OutputBelowMinimum));
}

#[test]
fn refuses_any_route_that_spends_differently_or_keeps_funds() {
    let t = terms(30_000_000, 0, 100);
    let ok = balances(&t, t.amount_in, t.expected_out);
    let mut under = ok;
    under.source_after += 1; // route left funds in the swap authority's account
    let mut over = ok;
    over.source_after -= 1; // route also took pre-existing dust
    let mut transit = ok;
    transit.transit_after -= 1; // route drained the transit account
    let mut staging = ok;
    staging.staging_after -= 1; // staging paid more than the leg
    let mut shrink = ok;
    shrink.destination_after = shrink.destination_before - 1; // destination went down
    for (b, e) in [
        (under, GuardError::SwapBalanceMismatch),
        (over, GuardError::SwapBalanceMismatch),
        (transit, GuardError::SwapBalanceMismatch),
        (staging, GuardError::SwapBalanceMismatch),
        (shrink, GuardError::OutputBelowMinimum),
    ] {
        assert_eq!(verify_swap(&b, &t), Err(e));
    }
}

#[test]
fn zero_amounts_are_refused() {
    assert_eq!(leg_terms(0, 0, 6, 8, 20_000_000, -5, UNIT_MULTIPLIER_FP, 100), Err(GuardError::ZeroOutput));
    // One raw unit of USDC buys less than one raw unit of a $10^9 stock.
    assert_eq!(leg_terms(1, 0, 6, 0, 1_000_000_000, 0, UNIT_MULTIPLIER_FP, 100), Err(GuardError::ZeroOutput));
}

mod proptests {
    use super::*;
    use proptest::prelude::*;

    /// One adversarial route outcome for one leg: how much of `amount_in` it consumes (offset),
    /// what it delivers relative to `expected_out` (per mille), and whether it also drains
    /// staging or the transit account.
    #[derive(Debug, Clone, Copy)]
    struct Route {
        consume_offset: i8,
        deliver_permille: u16,
        drain_staging: u8,
        drain_transit: u8,
    }

    fn route() -> impl Strategy<Value = Route> {
        (
            prop_oneof![8 => Just(0i8), 1 => -3i8..=3],
            900u16..1_050,
            prop_oneof![9 => Just(0u8), 1 => 1u8..=5],
            prop_oneof![9 => Just(0u8), 1 => 1u8..=5],
        )
            .prop_map(|(consume_offset, deliver_permille, drain_staging, drain_transit)| Route {
                consume_offset,
                deliver_permille,
                drain_staging,
                drain_transit,
            })
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(2_000))]

        /// Whole schedules against adversarial routes, with the same acceptance function as the
        /// program and transaction atomicity (a failed leg reverts its whole batch, pull
        /// included). Invariants: at most `periods × amount` pulled; every accepted leg delivered
        /// at least its floor (so total delivered ≥ Σ min_out); staging never ends a
        /// transaction below its start balance and is exactly back at it when a period completes.
        #[test]
        fn schedules_pull_deliver_and_restore_staging(
            periods in 1u16..12,
            window in 0u16..=MAX_CATCH_UP_WINDOW,
            amount in 1_000_000u64..1_000_000_000,
            legs in 1usize..=5,
            fee_bps in prop_oneof![Just(0u16), 1u16..=MAX_PROTOCOL_FEE_BPS],
            slippage in 50u16..=300,
            staging_dust in 0u64..1_000,
            steps in proptest::collection::vec((0u64..3, 1u8..32, proptest::collection::vec(route(), 5)), 1..40),
        ) {
            let weights: Vec<u16> = (0..legs).map(|i| (10_000 / legs as u16) + u16::from(i < 10_000 % legs)).collect();
            let all: u32 = (1u32 << legs) - 1;
            let (mut last, mut index, mut pulled) = (NO_PERIOD, 0u64, 0u128);
            let (mut bitmap, mut staging, mut in_progress) = (0u32, staging_dust, NO_PERIOD);
            let (mut delivered, mut floors) = (0u128, 0u128);
            for (advance, mask_seed, outcomes) in steps {
                index += advance;
                let mask = (u32::from(mask_seed) & all) & !bitmap;
                if mask == 0 { continue; }
                // A transaction: start (and pull) only on the first leg of a period.
                let (mut tx_staging, mut tx_pulled, mut tx_period) = (staging, 0u64, in_progress);
                if bitmap == 0 {
                    let Ok(due) = runnable_period(last, periods, window, index) else { continue };
                    tx_staging += amount;
                    tx_pulled = amount;
                    tx_period = due.period;
                }
                let mut ok = true;
                let (mut tx_delivered, mut tx_floors) = (0u128, 0u128);
                for leg in (0..legs).filter(|i| mask & (1 << i) != 0) {
                    let r = outcomes[leg];
                    let t = leg_terms(leg_amount(amount, &weights, leg).unwrap(), fee_bps, 6, 8, 20_000_000, -5, UNIT_MULTIPLIER_FP, slippage).unwrap();
                    let consumed = (i128::from(t.amount_in) + i128::from(r.consume_offset)).max(0) as u64;
                    let received = u64::try_from(u128::from(t.expected_out) * u128::from(r.deliver_permille) / 1_000).unwrap();
                    let b = SwapBalances {
                        staging_before: tx_staging,
                        staging_after: tx_staging.saturating_sub(t.leg_funding + u64::from(r.drain_staging)),
                        source_before: 11,
                        source_after: (11 + t.amount_in).saturating_sub(consumed),
                        transit_before: 13,
                        transit_after: 13 - u64::from(r.drain_transit),
                        destination_before: 0,
                        destination_after: received,
                    };
                    match verify_swap(&b, &t) {
                        Ok(got) => {
                            prop_assert!(got >= t.min_out);
                            prop_assert_eq!(t.fee + t.amount_in, t.leg_funding);
                            tx_staging = b.staging_after;
                            tx_delivered += u128::from(got);
                            tx_floors += u128::from(t.min_out);
                        }
                        Err(_) => { ok = false; break; }
                    }
                }
                if !ok { continue; } // the whole transaction reverts
                staging = tx_staging;
                pulled += u128::from(tx_pulled);
                delivered += tx_delivered;
                floors += tx_floors;
                bitmap |= mask;
                in_progress = tx_period;
                if bitmap == all {
                    prop_assert_eq!(staging, staging_dust, "staging restored when the period completes");
                    last = in_progress;
                    in_progress = NO_PERIOD;
                    bitmap = 0;
                }
                prop_assert!(staging >= staging_dust, "staging never below its start");
                prop_assert!(pulled <= u128::from(periods) * u128::from(amount));
                prop_assert!(delivered >= floors);
            }
        }

        /// The fee never changes the floor, for any amount, price and fee.
        #[test]
        fn fee_never_lowers_the_floor(
            leg_funding in 1_000u64..1_000_000_000_000,
            fee_bps in 0u16..=MAX_PROTOCOL_FEE_BPS,
            slippage in 0u16..=MAX_SLIPPAGE_CEILING_BPS,
            price in 1i64..10_000_000_000,
        ) {
            let with = leg_terms(leg_funding, fee_bps, 6, 8, price, -5, UNIT_MULTIPLIER_FP, slippage);
            let without = leg_terms(leg_funding, 0, 6, 8, price, -5, UNIT_MULTIPLIER_FP, slippage);
            if let (Ok(a), Ok(b)) = (with, without) {
                prop_assert_eq!(a.min_out, b.min_out);
                prop_assert_eq!(a.fee + a.amount_in, leg_funding);
                prop_assert!(a.min_out <= a.expected_out);
            }
        }
    }
}

//! Pure schedule, allocation, fee, oracle and slippage math (CONTRACT-V1-SPEC §6). No floats:
//! the Token-2022 ScaledUiAmount multiplier (an IEEE-754 `f64` on-chain) is converted to fixed
//! point from its bit pattern with integer operations only. Everything is `checked_*` in u128.

use crate::constants::*;
use crate::errors::GuardError;

pub type MathResult<T> = core::result::Result<T, GuardError>;

/// Index of the schedule slot that contains `now`; `None` before `starts_at`.
pub fn schedule_index(now: i64, starts_at: i64, period_seconds: u64) -> Option<u64> {
    if now < starts_at || period_seconds == 0 {
        return None;
    }
    // now >= starts_at, so the difference is non-negative and fits in u64.
    let elapsed = u64::try_from(i128::from(now) - i128::from(starts_at)).ok()?;
    elapsed.checked_div(period_seconds)
}

/// The one period that may run now, and the periods it permanently skips.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Due {
    pub period: u16,
    pub newly_skipped: u16,
}

/// Oldest runnable period first. A period can run when it is not in the future
/// (`period <= index`), comes after the last executed one, and is inside the catch-up window
/// (`period >= index - window`). Periods between the last executed one and the chosen one can
/// never run again and are counted as skipped. Choosing the oldest runnable period means no
/// executor can skip an in-window period on purpose.
pub fn runnable_period(last_executed: u16, periods: u16, window: u16, index: u64) -> MathResult<Due> {
    let next: u64 = if last_executed == NO_PERIOD {
        0
    } else {
        u64::from(last_executed).checked_add(1).ok_or(GuardError::MathOverflow)?
    };
    if next >= u64::from(periods) || index < next {
        return Err(GuardError::NothingDue);
    }
    let oldest_in_window = index.saturating_sub(u64::from(window));
    let period = next.max(oldest_in_window);
    if period >= u64::from(periods) {
        return Err(GuardError::NothingDue);
    }
    let newly_skipped = period.checked_sub(next).ok_or(GuardError::MathOverflow)?;
    Ok(Due {
        period: u16::try_from(period).map_err(|_| GuardError::MathOverflow)?,
        newly_skipped: u16::try_from(newly_skipped).map_err(|_| GuardError::MathOverflow)?,
    })
}

/// Subscriptions delegation terms a plan requires. The upstream program caps pulls per time
/// period with no carry-over, so a caught-up installment uses the next period's allowance: the
/// per-period allowance covers `1 + window` installments and the delegation outlives the
/// schedule by `window` periods. The plan's own accounting still pulls exactly one installment
/// per plan period (see `proptests::never_pulls_more_than_periods_times_amount`).
pub fn delegation_terms(
    funding_amount: u64,
    window: u16,
    period_seconds: u64,
    expires_at: i64,
) -> MathResult<(u64, i64)> {
    let per_period = funding_amount
        .checked_mul(u64::from(window).checked_add(1).ok_or(GuardError::MathOverflow)?)
        .ok_or(GuardError::MathOverflow)?;
    let grace = period_seconds
        .checked_mul(u64::from(window))
        .ok_or(GuardError::MathOverflow)?;
    let expiry = expires_at
        .checked_add(i64::try_from(grace).map_err(|_| GuardError::MathOverflow)?)
        .ok_or(GuardError::MathOverflow)?;
    Ok((per_period, expiry))
}

/// Funding for leg `leg`: the difference of cumulative floors, so the legs always sum to
/// exactly `funding_amount` whatever order the legs execute in.
pub fn leg_amount(funding_amount: u64, weights: &[u16], leg: usize) -> MathResult<u64> {
    if leg >= weights.len() {
        return Err(GuardError::InvalidLegMask);
    }
    let before: u128 = weights[..leg].iter().map(|w| u128::from(*w)).sum();
    let through = before
        .checked_add(u128::from(weights[leg]))
        .ok_or(GuardError::MathOverflow)?;
    let amount = u128::from(funding_amount);
    let hi = amount
        .checked_mul(through)
        .ok_or(GuardError::MathOverflow)?
        .checked_div(BPS_DENOMINATOR)
        .ok_or(GuardError::MathOverflow)?;
    let lo = amount
        .checked_mul(before)
        .ok_or(GuardError::MathOverflow)?
        .checked_div(BPS_DENOMINATOR)
        .ok_or(GuardError::MathOverflow)?;
    u64::try_from(hi.checked_sub(lo).ok_or(GuardError::MathOverflow)?).map_err(|_| GuardError::MathOverflow)
}

/// `floor(amount × bps / 10,000)`.
pub fn bps_of(amount: u64, bps: u16) -> MathResult<u64> {
    let value = u128::from(amount)
        .checked_mul(u128::from(bps))
        .ok_or(GuardError::MathOverflow)?
        .checked_div(BPS_DENOMINATOR)
        .ok_or(GuardError::MathOverflow)?;
    u64::try_from(value).map_err(|_| GuardError::MathOverflow)
}

/// `floor(expected × (10,000 − slippage_bps) / 10,000)`.
pub fn min_out(expected: u64, slippage_bps: u16) -> MathResult<u64> {
    let keep = TOTAL_WEIGHT_BPS
        .checked_sub(slippage_bps)
        .ok_or(GuardError::SlippageAboveCap)?;
    bps_of(expected, keep)
}

/// A Pyth price as the program uses it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OraclePrice {
    pub price: i64,
    pub conf: u64,
    pub expo: i32,
    pub publish_time: i64,
}

/// Positive price, at most `max_age_s` old, and `conf / price <= max_conf_bps`.
pub fn check_price(p: &OraclePrice, now: i64, max_age_s: u32, max_conf_bps: u16) -> MathResult<()> {
    if p.price <= 0 {
        return Err(GuardError::NonPositivePrice);
    }
    let age = now.saturating_sub(p.publish_time);
    if age > i64::from(max_age_s) {
        return Err(GuardError::StalePrice);
    }
    let conf_scaled = u128::from(p.conf)
        .checked_mul(BPS_DENOMINATOR)
        .ok_or(GuardError::MathOverflow)?;
    let allowed = u128::from(p.price.unsigned_abs())
        .checked_mul(u128::from(max_conf_bps))
        .ok_or(GuardError::MathOverflow)?;
    if conf_scaled > allowed {
        return Err(GuardError::ConfidenceTooWide);
    }
    Ok(())
}

fn pow10(exp: u32) -> MathResult<u128> {
    10u128.checked_pow(exp).ok_or(GuardError::MathOverflow)
}

/// The multiplier as fixed point with 12 decimals for a plain SPL mint (exactly 1).
pub const UNIT_MULTIPLIER_FP: u128 = 1_000_000_000_000;

/// Raw output units worth `amount_in` raw funding units at `price × 10^expo` USD per share,
/// where one output token (10^decimals raw) is `multiplier_fp / 10^12` shares. The funding token
/// is a USD stablecoin valued at 1 USD (spec §6). Rounds down, so the result is never worth more
/// than the oracle value of `amount_in`:
///
/// `out = amount_in × 10^(out_dec − fund_dec − expo + 12) / (price × multiplier_fp)`
pub fn expected_out(
    amount_in: u64,
    funding_decimals: u8,
    output_decimals: u8,
    price: i64,
    expo: i32,
    multiplier_fp: u128,
) -> MathResult<u64> {
    if price <= 0 {
        return Err(GuardError::NonPositivePrice);
    }
    if multiplier_fp == 0 {
        return Err(GuardError::InvalidMultiplier);
    }
    let exp = i64::from(output_decimals) - i64::from(funding_decimals) - i64::from(expo)
        + i64::from(MULTIPLIER_SCALE_DECIMALS);
    let mut numerator = u128::from(amount_in);
    let mut denominator = u128::from(price.unsigned_abs())
        .checked_mul(multiplier_fp)
        .ok_or(GuardError::MathOverflow)?;
    let magnitude = u32::try_from(exp.unsigned_abs()).map_err(|_| GuardError::MathOverflow)?;
    if exp >= 0 {
        numerator = numerator.checked_mul(pow10(magnitude)?).ok_or(GuardError::MathOverflow)?;
    } else {
        denominator = denominator.checked_mul(pow10(magnitude)?).ok_or(GuardError::MathOverflow)?;
    }
    let out = numerator.checked_div(denominator).ok_or(GuardError::MathOverflow)?;
    u64::try_from(out).map_err(|_| GuardError::MathOverflow)
}

/// Converts an IEEE-754 binary64 bit pattern to fixed point (×10^12), rounding **up** so that a
/// larger multiplier yields fewer output tokens (never more than the oracle value). Integer
/// operations only. Rejects negative, zero, subnormal, infinite and NaN values and anything
/// outside [10^-6, 10^6].
pub fn multiplier_fp_ceil(bits: u64) -> MathResult<u128> {
    let sign = bits >> 63;
    let biased = (bits >> 52) & 0x7ff;
    let fraction = bits & ((1u64 << 52) - 1);
    if sign != 0 || biased == 0 || biased == 0x7ff {
        return Err(GuardError::InvalidMultiplier);
    }
    // value = mantissa × 2^(biased − 1075)
    let mantissa = u128::from(fraction | (1u64 << 52));
    let scaled = mantissa
        .checked_mul(UNIT_MULTIPLIER_FP)
        .ok_or(GuardError::MathOverflow)?;
    let shift = i64::try_from(biased).map_err(|_| GuardError::MathOverflow)? - 1075;
    let fp = if shift >= 0 {
        let s = u32::try_from(shift).map_err(|_| GuardError::InvalidMultiplier)?;
        if s >= 34 {
            return Err(GuardError::InvalidMultiplier);
        }
        scaled.checked_shl(s).ok_or(GuardError::MathOverflow)?
    } else {
        let s = u32::try_from(-shift).map_err(|_| GuardError::MathOverflow)?;
        if s >= 127 {
            1
        } else {
            let q = scaled >> s;
            if q << s == scaled {
                q
            } else {
                q.checked_add(1).ok_or(GuardError::MathOverflow)?
            }
        }
    };
    if !(MIN_MULTIPLIER_FP..=MAX_MULTIPLIER_FP).contains(&fp) {
        return Err(GuardError::InvalidMultiplier);
    }
    Ok(fp)
}

/// Token-2022 rule (`ScaledUiAmountConfig::current_multiplier`): the new multiplier applies from
/// its effective timestamp on.
pub fn effective_multiplier_bits(current: u64, new: u64, new_effective_ts: i64, now: i64) -> u64 {
    if now >= new_effective_ts {
        new
    } else {
        current
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: u64 = 86_400;

    #[test]
    fn schedule_index_is_none_before_start_and_floors_after() {
        assert_eq!(schedule_index(99, 100, 10), None);
        assert_eq!(schedule_index(100, 100, 10), Some(0));
        assert_eq!(schedule_index(109, 100, 10), Some(0));
        assert_eq!(schedule_index(110, 100, 10), Some(1));
        assert_eq!(schedule_index(i64::MAX, i64::MIN, 1), Some(u64::MAX));
        assert_eq!(schedule_index(100, 100, 0), None);
    }

    #[test]
    fn on_time_periods_run_in_order_and_never_replay() {
        let d = runnable_period(NO_PERIOD, 4, 1, 0).unwrap();
        assert_eq!(d, Due { period: 0, newly_skipped: 0 });
        // Period 0 executed; still index 0: nothing due (no replay, no future period).
        assert_eq!(runnable_period(0, 4, 1, 0), Err(GuardError::NothingDue));
        assert_eq!(runnable_period(0, 4, 1, 1).unwrap(), Due { period: 1, newly_skipped: 0 });
    }

    #[test]
    fn catch_up_inside_the_window_runs_the_missed_period_first() {
        // Period 1 missed; index 2, window 1: period 1 (late) runs before period 2.
        assert_eq!(runnable_period(0, 4, 1, 2).unwrap(), Due { period: 1, newly_skipped: 0 });
        // Then period 2 in the same slot.
        assert_eq!(runnable_period(1, 4, 1, 2).unwrap(), Due { period: 2, newly_skipped: 0 });
    }

    #[test]
    fn periods_older_than_the_window_are_skipped() {
        // Last executed 0, index 3, window 1: periods 1 is outside the window → skipped, 2 runs.
        assert_eq!(runnable_period(0, 5, 1, 3).unwrap(), Due { period: 2, newly_skipped: 1 });
        // Window 0: only the current period may run.
        assert_eq!(runnable_period(NO_PERIOD, 5, 0, 3).unwrap(), Due { period: 3, newly_skipped: 3 });
    }

    #[test]
    fn nothing_runs_after_the_last_period_or_outside_the_window_at_the_end() {
        assert_eq!(runnable_period(3, 4, 1, 9), Err(GuardError::NothingDue));
        // Last executed 1 of 4, index 9: periods 2 and 3 are all outside the window.
        assert_eq!(runnable_period(1, 4, 1, 9), Err(GuardError::NothingDue));
        // The final period can still be caught up one slot after the schedule ends.
        assert_eq!(runnable_period(2, 4, 1, 4).unwrap(), Due { period: 3, newly_skipped: 0 });
    }

    #[test]
    fn delegation_terms_cover_one_catch_up_and_outlive_the_schedule() {
        assert_eq!(delegation_terms(100, 1, DAY, 1_000).unwrap(), (200, 1_000 + DAY as i64));
        assert_eq!(delegation_terms(100, 0, DAY, 1_000).unwrap(), (100, 1_000));
        assert!(delegation_terms(u64::MAX, 1, DAY, 0).is_err());
    }

    #[test]
    fn legs_always_sum_to_the_installment() {
        let weights = [3_333, 3_333, 3_334];
        let amounts: Vec<u64> = (0..3).map(|i| leg_amount(100, &weights, i).unwrap()).collect();
        assert_eq!(amounts, vec![33, 33, 34]);
        assert_eq!(amounts.iter().sum::<u64>(), 100);
        assert_eq!(leg_amount(u64::MAX, &[10_000], 0).unwrap(), u64::MAX);
        assert_eq!(leg_amount(100, &weights, 3), Err(GuardError::InvalidLegMask));
    }

    #[test]
    fn slippage_floor_and_fee_round_down() {
        assert_eq!(min_out(1_000_000, 300).unwrap(), 970_000);
        assert_eq!(min_out(999, 1).unwrap(), 998); // 999 × 0.9999 = 998.9 → 998
        assert_eq!(min_out(5, 0).unwrap(), 5);
        assert_eq!(min_out(5, 10_001), Err(GuardError::SlippageAboveCap));
        assert_eq!(bps_of(1_000_000, 0).unwrap(), 0);
        assert_eq!(bps_of(1_000_000, 25).unwrap(), 2_500);
        assert_eq!(bps_of(399, 25).unwrap(), 0);
    }

    fn price(p: i64, conf: u64, publish_time: i64) -> OraclePrice {
        OraclePrice { price: p, conf, expo: -5, publish_time }
    }

    #[test]
    fn staleness_is_bounded_inclusively() {
        assert!(check_price(&price(100, 0, 1_000), 1_060, 60, 100).is_ok());
        assert_eq!(check_price(&price(100, 0, 1_000), 1_061, 60, 100), Err(GuardError::StalePrice));
        // A publish time slightly ahead of the validator clock is accepted (age 0).
        assert!(check_price(&price(100, 0, 1_005), 1_000, 60, 100).is_ok());
    }

    #[test]
    fn confidence_and_sign_are_checked() {
        assert!(check_price(&price(10_000, 100, 0), 0, 60, 100).is_ok()); // exactly 1%
        assert_eq!(check_price(&price(10_000, 101, 0), 0, 60, 100), Err(GuardError::ConfidenceTooWide));
        assert_eq!(check_price(&price(0, 0, 0), 0, 60, 100), Err(GuardError::NonPositivePrice));
        assert_eq!(check_price(&price(-1, 0, 0), 0, 60, 100), Err(GuardError::NonPositivePrice));
    }

    #[test]
    fn expected_out_handles_decimals_and_rounds_down() {
        // 100 USDC (6 dp) at $200.00000 (expo −5) per share, 8-dp token, multiplier 1:
        // 0.5 token = 50,000,000 raw.
        assert_eq!(expected_out(100_000_000, 6, 8, 20_000_000, -5, UNIT_MULTIPLIER_FP).unwrap(), 50_000_000);
        // Same with a 6-dp output token: 500,000 raw.
        assert_eq!(expected_out(100_000_000, 6, 6, 20_000_000, -5, UNIT_MULTIPLIER_FP).unwrap(), 500_000);
        // 1 raw unit at $3 per share, 0 dp output: rounds to 0.
        assert_eq!(expected_out(1, 6, 0, 300_000, -5, UNIT_MULTIPLIER_FP).unwrap(), 0);
        // $1 / $3 with 6-dp output: 333,333 (down, not 333,334).
        assert_eq!(expected_out(1_000_000, 6, 6, 300_000, -5, UNIT_MULTIPLIER_FP).unwrap(), 333_333);
        // Positive exponent and a large decimal gap still compute or fail closed, never wrap.
        assert_eq!(expected_out(1_000_000, 6, 6, 3, 5, UNIT_MULTIPLIER_FP).unwrap(), 3);
        assert_eq!(expected_out(u64::MAX, 0, 18, 1, -12, UNIT_MULTIPLIER_FP), Err(GuardError::MathOverflow));
        assert_eq!(expected_out(1, 6, 6, 0, -5, UNIT_MULTIPLIER_FP), Err(GuardError::NonPositivePrice));
    }

    #[test]
    fn scaled_amount_gives_fewer_tokens_per_dollar() {
        // AAPLx on mainnet (slot 469,277,079): multiplier 1.0038023030588032.
        let m = multiplier_fp_ceil(1.003_802_303_058_803_2f64.to_bits()).unwrap();
        assert_eq!(m, 1_003_802_303_059);
        let plain = expected_out(100_000_000, 6, 8, 20_000_000, -5, UNIT_MULTIPLIER_FP).unwrap();
        let scaled = expected_out(100_000_000, 6, 8, 20_000_000, -5, m).unwrap();
        assert!(scaled < plain);
        // 50,000,000 / 1.003802303059 = 49,810,604.6 → 49,810,604
        assert_eq!(scaled, 49_810_604);
    }

    #[test]
    fn multiplier_conversion_is_exact_and_rounds_up() {
        assert_eq!(multiplier_fp_ceil(1.0f64.to_bits()).unwrap(), UNIT_MULTIPLIER_FP);
        assert_eq!(multiplier_fp_ceil(2.5f64.to_bits()).unwrap(), 2_500_000_000_000);
        assert_eq!(multiplier_fp_ceil(0.5f64.to_bits()).unwrap(), 500_000_000_000);
        // 0.1 is not exact in binary: 0.1000000000000000055… → ceil at 12 dp.
        assert_eq!(multiplier_fp_ceil(0.1f64.to_bits()).unwrap(), 100_000_000_001);
        for bad in [0.0f64, -1.0, f64::INFINITY, f64::NAN, 1e-7, 1e7, f64::MIN_POSITIVE / 2.0] {
            assert_eq!(multiplier_fp_ceil(bad.to_bits()), Err(GuardError::InvalidMultiplier), "{bad}");
        }
        assert!(multiplier_fp_ceil(1e6f64.to_bits()).is_ok());
        assert!(multiplier_fp_ceil(1e-6f64.to_bits()).is_ok());
    }

    #[test]
    fn the_new_multiplier_applies_from_its_timestamp() {
        let (a, b) = (1.0f64.to_bits(), 2.0f64.to_bits());
        assert_eq!(effective_multiplier_bits(a, b, 100, 99), a);
        assert_eq!(effective_multiplier_bits(a, b, 100, 100), b);
    }
}

#[cfg(test)]
mod proptests {
    use super::*;
    use proptest::prelude::*;

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(2_000))]

        /// Simulates any sequence of execution attempts at non-decreasing times. However the
        /// executor behaves, the program pulls at most `periods × amount`, and
        /// executed + skipped never exceeds `periods`.
        #[test]
        fn never_pulls_more_than_periods_times_amount(
            periods in 1u16..60,
            window in 0u16..=MAX_CATCH_UP_WINDOW,
            amount in 1u64..=u64::MAX / 64,
            steps in proptest::collection::vec((0u64..4, 0u16..70), 1..120),
        ) {
            let mut last = NO_PERIOD;
            let (mut executed, mut skipped, mut pulled) = (0u16, 0u16, 0u128);
            let mut index = 0u64;
            for (advance, requested) in steps {
                index += advance;
                if let Ok(due) = runnable_period(last, periods, window, index) {
                    // An executor may request any period; only the runnable one is accepted.
                    if requested != due.period { continue; }
                    prop_assert!(due.period < periods);
                    prop_assert!(u64::from(due.period) <= index);
                    prop_assert!(u64::from(due.period) + u64::from(window) >= index);
                    skipped += due.newly_skipped;
                    executed += 1;
                    pulled += u128::from(amount);
                    last = due.period;
                    prop_assert_eq!(u32::from(executed) + u32::from(skipped), u32::from(last) + 1);
                }
                prop_assert!(executed + skipped <= periods);
                prop_assert!(pulled <= u128::from(periods) * u128::from(amount));
            }
        }

        #[test]
        fn legs_sum_exactly_for_any_weights(amount in any::<u64>(), cuts in proptest::collection::vec(1u16..10_000, 0..19)) {
            let mut points: Vec<u16> = cuts; points.sort(); points.dedup();
            let mut weights = Vec::new(); let mut prev = 0u16;
            for p in points.iter().chain(std::iter::once(&10_000u16)) { weights.push(p - prev); prev = *p; }
            let total: u128 = (0..weights.len()).map(|i| u128::from(leg_amount(amount, &weights, i).unwrap())).sum();
            prop_assert_eq!(total, u128::from(amount));
        }

        /// No path mints more than oracle value: out × price × multiplier ≤ amount_in (scaled).
        #[test]
        fn expected_out_never_exceeds_oracle_value(
            amount in 1u64..1_000_000_000_000,
            price in 1i64..10_000_000_000,
            expo in -10i32..=0,
            out_dec in 0u8..=9,
            mbits in 0.5f64..3.0,
        ) {
            let m = multiplier_fp_ceil(mbits.to_bits()).unwrap();
            if let Ok(out) = expected_out(amount, 6, out_dec, price, expo, m) {
                // value(out) = out × price × 10^expo × m/10^12 / 10^out_dec  ≤  amount / 10^6
                let lhs = primitive_u256(out, price, m, out_dec, expo);
                let rhs = rhs_u256(amount, out_dec, expo);
                prop_assert!(lhs <= rhs);
            }
        }
    }

    // Exact comparison helpers in 256 bits (tests only): both sides multiplied by
    // 10^(6 + out_dec + 12 − expo) to clear denominators.
    fn mul_u256(a: [u128; 2], b: u128) -> [u128; 2] {
        let (lo, hi) = (a[0], a[1]);
        let mask = u64::MAX as u128;
        let (l0, l1) = (lo & mask, lo >> 64);
        let (b0, b1) = (b & mask, b >> 64);
        let p00 = l0 * b0;
        let p01 = l0 * b1;
        let p10 = l1 * b0;
        let p11 = l1 * b1;
        let mid = (p00 >> 64) + (p01 & mask) + (p10 & mask);
        let new_lo = (p00 & mask) | (mid << 64);
        let carry = (mid >> 64) + (p01 >> 64) + (p10 >> 64) + p11;
        [new_lo, hi * b + carry]
    }
    fn primitive_u256(out: u64, price: i64, m: u128, _out_dec: u8, _expo: i32) -> [u128; 2] {
        let x = mul_u256([u128::from(out), 0], price as u128);
        let x = mul_u256(x, m);
        // swap to (hi, lo) ordering for comparison
        [x[1], x[0]]
    }
    fn rhs_u256(amount: u64, out_dec: u8, expo: i32) -> [u128; 2] {
        let e = i64::from(out_dec) - 6 - i64::from(expo) + 12;
        let mut x = [u128::from(amount), 0];
        for _ in 0..e { x = mul_u256(x, 10); }
        [x[1], x[0]]
    }
}

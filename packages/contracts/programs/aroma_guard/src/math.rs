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
#[path = "math_tests.rs"]
mod math_tests;

//! Pyth price reads (CONTRACT-V1-SPEC §6, step 4) with the official receiver SDK
//! (`pyth-solana-receiver-sdk` 2.0.0, which builds against anchor-lang 1.2.1).
//!
//! The account must be owned by the Pyth receiver program (`rec5EKMG…`), carry the Anchor
//! `PriceUpdateV2` discriminator (checked by `try_deserialize`), be **fully** verified (all
//! Wormhole guardian signatures checked by the receiver), match the asset's feed id, be no older
//! than `max_oracle_staleness_s`, and have `conf / price` within `max_confidence_bps`. Any
//! receiver-owned update is accepted (a sponsored push-feed account or one the keeper posts in
//! the same transaction), because only these checks establish its validity.

use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::price_update::{PriceUpdateV2, VerificationLevel};

use crate::errors::GuardError;
use crate::math::{check_price, OraclePrice};

pub const PYTH_RECEIVER_PROGRAM_ID: Pubkey = pyth_solana_receiver_sdk::ID;

pub fn read_price(
    account: &AccountInfo,
    feed_id: &[u8; 32],
    now: i64,
    max_age_s: u32,
    max_conf_bps: u16,
) -> Result<OraclePrice> {
    require_keys_eq!(*account.owner, PYTH_RECEIVER_PROGRAM_ID, GuardError::InvalidPriceAccount);
    let data = account.try_borrow_data()?;
    let update = PriceUpdateV2::try_deserialize(&mut &data[..]).map_err(|_| GuardError::InvalidPriceAccount)?;
    require!(update.verification_level == VerificationLevel::Full, GuardError::PriceNotFullyVerified);
    let message = &update.price_message;
    require!(message.feed_id == *feed_id, GuardError::PriceFeedMismatch);
    let price = OraclePrice {
        price: message.price,
        conf: message.conf,
        expo: message.exponent,
        publish_time: message.publish_time,
    };
    check_price(&price, now, max_age_s, max_conf_bps)?;
    Ok(price)
}

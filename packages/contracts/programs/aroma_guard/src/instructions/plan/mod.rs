pub mod close_plan;
pub mod create_plan;
pub mod pause_plan;

pub use close_plan::*;
pub use create_plan::*;
pub use pause_plan::*;

use crate::constants::PLAN_SEED;
use crate::state::Plan;

/// Signer seeds of a plan PDA, with a caller-owned buffer for the nonce and bump.
pub fn plan_seeds<'a>(plan: &'a Plan, nonce: &'a [u8; 8], bump: &'a [u8; 1]) -> [&'a [u8]; 5] {
    [PLAN_SEED, plan.owner.as_ref(), plan.funding_mint.as_ref(), nonce, bump]
}

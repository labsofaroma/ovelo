use anchor_lang::prelude::*;

use crate::events::ProtocolPauseSet;
use crate::instructions::admin::update_config::AdminConfig;

/// Pause blocks `create_plan` and `execute_installment`. Closing a plan always works.
pub fn set_paused_handler(ctx: Context<AdminConfig>, paused: bool) -> Result<()> {
    ctx.accounts.config.paused = paused;
    emit!(ProtocolPauseSet { paused });
    Ok(())
}

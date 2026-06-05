use anchor_lang::prelude::*;

use crate::state::SlowSendConfig;

#[derive(Accounts)]
pub struct DisableSlowSend<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

    #[account(
        mut,
        close = sender,
        seeds = [SlowSendConfig::SEED_PREFIX, sender.key().as_ref(), config.stede_mint.as_ref()],
        bump = config.bump,
        has_one = sender,
    )]
    pub config: Account<'info, SlowSendConfig>,
}

pub fn disable_slow_send_handler(ctx: Context<DisableSlowSend>) -> Result<()> {
    msg!(
        "Slow Send disabled for sender {} on mint {}. Rent refunded.",
        ctx.accounts.sender.key(),
        ctx.accounts.config.stede_mint,
    );
    Ok(())
}
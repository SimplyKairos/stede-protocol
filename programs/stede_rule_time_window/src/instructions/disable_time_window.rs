use anchor_lang::prelude::*;

use crate::state::{TimeWindowConfig, SEED_PREFIX};

#[derive(Accounts)]
pub struct DisableTimeWindow<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

    #[account(
        mut,
        close = sender,
        has_one = sender,
        seeds = [SEED_PREFIX, sender.key().as_ref(), config.stede_mint.as_ref()],
        bump = config.bump
    )]
    pub config: Account<'info, TimeWindowConfig>,
}

pub fn disable_time_window_handler(_ctx: Context<DisableTimeWindow>) -> Result<()> {
    Ok(())
}

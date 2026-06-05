use anchor_lang::prelude::*;

use crate::errors::TimeWindowError;
use crate::state::{TimeWindowConfig, SEED_PREFIX};

#[derive(Accounts)]
pub struct SetTimeWindow<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

    /// CHECK: mint key only used as a PDA seed
    pub stede_mint: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = sender,
        space = 8 + TimeWindowConfig::INIT_SPACE,
        seeds = [SEED_PREFIX, sender.key().as_ref(), stede_mint.key().as_ref()],
        bump
    )]
    pub config: Account<'info, TimeWindowConfig>,

    pub system_program: Program<'info, System>,
}

pub fn set_time_window_handler(
    ctx: Context<SetTimeWindow>,
    start_hour: u8,
    end_hour: u8,
) -> Result<()> {
    require!(start_hour < 24 && end_hour < 24, TimeWindowError::InvalidHour);

    let config = &mut ctx.accounts.config;
    config.sender = ctx.accounts.sender.key();
    config.stede_mint = ctx.accounts.stede_mint.key();
    config.start_hour = start_hour;
    config.end_hour = end_hour;
    config.bump = ctx.bumps.config;

    Ok(())
}

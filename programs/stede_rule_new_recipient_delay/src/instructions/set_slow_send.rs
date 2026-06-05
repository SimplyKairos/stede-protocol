use anchor_lang::prelude::*;

use crate::{
    errors::SlowSendError,
    state::{SlowSendConfig, MAX_DELAY_SECONDS, MIN_DELAY_SECONDS},
};

#[derive(Accounts)]
pub struct SetSlowSend<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

    /// CHECK: pubkey input, used as PDA seed and stored.
    pub stede_mint: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = sender,
        space = 8 + SlowSendConfig::INIT_SPACE,
        seeds = [SlowSendConfig::SEED_PREFIX, sender.key().as_ref(), stede_mint.key().as_ref()],
        bump,
    )]
    pub config: Account<'info, SlowSendConfig>,

    pub system_program: Program<'info, System>,
}

pub fn set_slow_send_handler(ctx: Context<SetSlowSend>, delay_seconds: i64) -> Result<()> {
    require!(
        delay_seconds >= MIN_DELAY_SECONDS && delay_seconds <= MAX_DELAY_SECONDS,
        SlowSendError::InvalidDelay
    );

    let config = &mut ctx.accounts.config;
    let sender_key = ctx.accounts.sender.key();
    let stede_mint_key = ctx.accounts.stede_mint.key();

    if config.sender == Pubkey::default() {
        config.sender = sender_key;
        config.stede_mint = stede_mint_key;
        config.bump = ctx.bumps.config;
    }

    config.delay_seconds = delay_seconds;

    msg!(
        "Slow Send set for sender {} on mint {}. Delay: {}s",
        sender_key,
        stede_mint_key,
        delay_seconds,
    );

    Ok(())
}
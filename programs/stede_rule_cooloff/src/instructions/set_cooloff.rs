use anchor_lang::prelude::*;

use crate::{
    errors::CooloffError,
    state::{Cooloff, MAX_DURATION_SECONDS, MIN_DURATION_SECONDS},
};

#[derive(Accounts)]
pub struct SetCooloff<'info> {
    /// The sender configuring this rule.
    #[account(mut)]
    pub sender: Signer<'info>,

    /// CHECK: pubkey input, used as PDA seed and stored as data.
    pub stede_mint: UncheckedAccount<'info>,

    /// The Cooloff PDA for (sender, stede_mint).
    /// init_if_needed: first set creates the PDA, subsequent calls update it.
    #[account(
        init_if_needed,
        payer = sender,
        space = 8 + Cooloff::INIT_SPACE,
        seeds = [Cooloff::SEED_PREFIX, sender.key().as_ref(), stede_mint.key().as_ref()],
        bump,
    )]
    pub cooloff: Account<'info, Cooloff>,

    pub system_program: Program<'info, System>,
}

pub fn set_cooloff_handler(
    ctx: Context<SetCooloff>,
    threshold: u64,
    duration_seconds: i64,
) -> Result<()> {
    require!(threshold > 0, CooloffError::ZeroThreshold);
    require!(
        duration_seconds >= MIN_DURATION_SECONDS && duration_seconds <= MAX_DURATION_SECONDS,
        CooloffError::InvalidDuration
    );

    let cooloff = &mut ctx.accounts.cooloff;
    let sender_key = ctx.accounts.sender.key();
    let stede_mint_key = ctx.accounts.stede_mint.key();

    // First-time PDA creation: initialize metadata fields.
    // On subsequent updates, we preserve last_large_transfer_at so users
    // can't reset the cool-off by reconfiguring the rule.
    if cooloff.sender == Pubkey::default() {
        cooloff.sender = sender_key;
        cooloff.stede_mint = stede_mint_key;
        cooloff.last_large_transfer_at = 0;
        cooloff.bump = ctx.bumps.cooloff;
    }

    cooloff.threshold = threshold;
    cooloff.duration_seconds = duration_seconds;

    msg!(
        "Cooloff set for sender {} on mint {}. Threshold: {}, duration: {}s",
        sender_key,
        stede_mint_key,
        threshold,
        duration_seconds,
    );

    Ok(())
}
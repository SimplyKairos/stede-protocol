use anchor_lang::prelude::*;

use crate::{errors::DailyLimitError, state::DailyLimit};

#[derive(Accounts)]
pub struct SetLimit<'info> {
    /// The sender setting their own daily limit.
    #[account(mut)]
    pub sender: Signer<'info>,

    /// CHECK: just a pubkey input identifying which Stede mint this limit applies to.
    /// Not deserialized here — only used as a PDA seed and stored as data.
    pub stede_mint: UncheckedAccount<'info>,

    /// The DailyLimit PDA for (sender, stede_mint).
    /// Init-if-needed: first call creates it, subsequent calls update.
    #[account(
        init_if_needed,
        payer = sender,
        space = 8 + DailyLimit::INIT_SPACE,
        seeds = [DailyLimit::SEED_PREFIX, sender.key().as_ref(), stede_mint.key().as_ref()],
        bump,
    )]
    pub daily_limit: Account<'info, DailyLimit>,

    pub system_program: Program<'info, System>,
}

pub fn set_limit_handler(ctx: Context<SetLimit>, limit: u64) -> Result<()> {
    require!(limit > 0, DailyLimitError::ZeroLimit);

    let daily_limit = &mut ctx.accounts.daily_limit;
    let current_slot = Clock::get()?.slot;

    // If this is the first time the PDA is being created, sender and stede_mint
    // are zeroed. We set them now.
    if daily_limit.sender == Pubkey::default() {
        daily_limit.sender = ctx.accounts.sender.key();
        daily_limit.stede_mint = ctx.accounts.stede_mint.key();
        daily_limit.window_start_slot = current_slot;
        daily_limit.spent_today = 0;
        daily_limit.bump = ctx.bumps.daily_limit;
    }

    daily_limit.limit = limit;

    msg!(
        "Daily limit set for {} on mint {}: {} base units",
        daily_limit.sender,
        daily_limit.stede_mint,
        daily_limit.limit
    );

    Ok(())
}
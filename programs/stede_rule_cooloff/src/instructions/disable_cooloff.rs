use anchor_lang::prelude::*;

use crate::state::Cooloff;

#[derive(Accounts)]
pub struct DisableCooloff<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

    #[account(
        mut,
        close = sender,
        seeds = [Cooloff::SEED_PREFIX, sender.key().as_ref(), cooloff.stede_mint.as_ref()],
        bump = cooloff.bump,
        has_one = sender,
    )]
    pub cooloff: Account<'info, Cooloff>,
}

pub fn disable_cooloff_handler(ctx: Context<DisableCooloff>) -> Result<()> {
    msg!(
        "Cooloff disabled for sender {} on mint {}. Rent refunded.",
        ctx.accounts.sender.key(),
        ctx.accounts.cooloff.stede_mint,
    );
    Ok(())
}
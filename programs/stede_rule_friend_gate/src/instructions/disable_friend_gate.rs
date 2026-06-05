use anchor_lang::prelude::*;

use crate::state::FriendGate;

#[derive(Accounts)]
pub struct DisableFriendGate<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

    #[account(
        mut,
        close = sender,
        seeds = [FriendGate::SEED_PREFIX, sender.key().as_ref(), friend_gate.stede_mint.as_ref()],
        bump = friend_gate.bump,
        has_one = sender,
    )]
    pub friend_gate: Account<'info, FriendGate>,
}

pub fn disable_friend_gate_handler(ctx: Context<DisableFriendGate>) -> Result<()> {
    msg!(
        "Friend Gate disabled for sender {} on mint {}. Rent refunded.",
        ctx.accounts.sender.key(),
        ctx.accounts.friend_gate.stede_mint,
    );
    Ok(())
}
use anchor_lang::prelude::*;

use crate::{errors::FriendGateError, state::FriendGate};

#[derive(Accounts)]
pub struct SetFriendGate<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

    /// CHECK: pubkey input, used as PDA seed and stored.
    pub stede_mint: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = sender,
        space = 8 + FriendGate::INIT_SPACE,
        seeds = [FriendGate::SEED_PREFIX, sender.key().as_ref(), stede_mint.key().as_ref()],
        bump,
    )]
    pub friend_gate: Account<'info, FriendGate>,

    pub system_program: Program<'info, System>,
}

pub fn set_friend_gate_handler(
    ctx: Context<SetFriendGate>,
    threshold: u64,
    friend_wallet: Pubkey,
) -> Result<()> {
    require!(threshold > 0, FriendGateError::ZeroThreshold);
    require!(friend_wallet != Pubkey::default(), FriendGateError::ZeroFriend);
    require!(
        friend_wallet != ctx.accounts.sender.key(),
        FriendGateError::FriendIsSelf
    );

    let fg = &mut ctx.accounts.friend_gate;
    let sender_key = ctx.accounts.sender.key();
    let stede_mint_key = ctx.accounts.stede_mint.key();

    if fg.sender == Pubkey::default() {
        fg.sender = sender_key;
        fg.stede_mint = stede_mint_key;
        fg.bump = ctx.bumps.friend_gate;
    }

    fg.threshold = threshold;
    fg.friend_wallet = friend_wallet;

    msg!(
        "Friend Gate set for sender {} on mint {}. Threshold: {}, friend: {}",
        sender_key,
        stede_mint_key,
        threshold,
        friend_wallet,
    );

    Ok(())
}
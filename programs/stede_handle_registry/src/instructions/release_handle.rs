use anchor_lang::prelude::*;

use crate::{
    errors::HandleError,
    state::{Handle, Reverse},
};

#[derive(Accounts)]
pub struct ReleaseHandle<'info> {
    /// The current owner of the handle. Receives the deposit refund.
    #[account(mut)]
    pub owner: Signer<'info>,

    /// Forward PDA. Closed on release, lamports refunded to owner.
    #[account(
        mut,
        close = owner,
        seeds = [Handle::SEED_PREFIX, handle_account.name.as_bytes()],
        bump = handle_account.bump,
        has_one = owner @ HandleError::NotOwner,
    )]
    pub handle_account: Account<'info, Handle>,

    /// Reverse PDA. Closed on release, rent refunded to owner.
    #[account(
        mut,
        close = owner,
        seeds = [Reverse::SEED_PREFIX, owner.key().as_ref()],
        bump = reverse_account.bump,
    )]
    pub reverse_account: Account<'info, Reverse>,
}

pub fn release_handle_handler(ctx: Context<ReleaseHandle>) -> Result<()> {
    msg!(
        "Handle '{}' released by {}. Deposit + rent refunded.",
        ctx.accounts.handle_account.name,
        ctx.accounts.owner.key()
    );

    // `close = owner` on both PDAs handles the refund automatically.
    Ok(())
}
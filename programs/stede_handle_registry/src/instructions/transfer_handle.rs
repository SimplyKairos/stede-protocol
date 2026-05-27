use anchor_lang::prelude::*;

use crate::{
    errors::HandleError,
    state::{Handle, Reverse},
};

#[derive(Accounts)]
pub struct TransferHandle<'info> {
    /// Current owner. Pays for the new reverse PDA, receives old reverse PDA's rent.
    #[account(mut)]
    pub current_owner: Signer<'info>,

    /// New owner. Must co-sign to prevent unsolicited handles.
    /// CHECK: validated as signer; doesn't need to be deserialized.
    pub new_owner: Signer<'info>,

    /// Forward PDA. Owner field is updated to new_owner.
    #[account(
        mut,
        seeds = [Handle::SEED_PREFIX, handle_account.name.as_bytes()],
        bump = handle_account.bump,
        constraint = handle_account.owner == current_owner.key() @ HandleError::NotOwner,    )]
    pub handle_account: Account<'info, Handle>,

    /// Old reverse PDA (current_owner → handle). Closed.
    #[account(
        mut,
        close = current_owner,
        seeds = [Reverse::SEED_PREFIX, current_owner.key().as_ref()],
        bump = old_reverse.bump,
    )]
    pub old_reverse: Account<'info, Reverse>,

    /// New reverse PDA (new_owner → handle). Created.
    /// Init: a new_owner already with a handle fails (their reverse PDA exists).
    #[account(
        init,
        payer = current_owner,
        space = 8 + Reverse::INIT_SPACE,
        seeds = [Reverse::SEED_PREFIX, new_owner.key().as_ref()],
        bump,
    )]
    pub new_reverse: Account<'info, Reverse>,

    pub system_program: Program<'info, System>,
}

pub fn transfer_handle_handler(ctx: Context<TransferHandle>) -> Result<()> {
    // `has_one = current_owner` already validated above.

    let handle_account = &mut ctx.accounts.handle_account;
    let handle_name = handle_account.name.clone();

    // Update forward PDA's owner field.
    handle_account.owner = ctx.accounts.new_owner.key();

    // Populate new reverse PDA.
    let new_reverse = &mut ctx.accounts.new_reverse;
    new_reverse.handle = handle_name.clone();
    new_reverse.bump = ctx.bumps.new_reverse;

    // Old reverse closes automatically via `close = current_owner`.

    msg!(
        "Handle '{}' transferred from {} to {}",
        handle_name,
        ctx.accounts.current_owner.key(),
        ctx.accounts.new_owner.key(),
    );

    Ok(())
}
use anchor_lang::prelude::*;

use crate::{errors::VaultError, state::Vault};

#[derive(Accounts)]
pub struct SetPaused<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [Vault::SEED_PREFIX, vault.underlying_mint.as_ref()],
        bump = vault.bump,
        has_one = admin @ VaultError::Unauthorized,
    )]
    pub vault: Account<'info, Vault>,
}

pub fn set_paused_handler(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
    ctx.accounts.vault.paused = paused;

    msg!("Vault {}: paused = {}", ctx.accounts.vault.key(), paused);

    Ok(())
}
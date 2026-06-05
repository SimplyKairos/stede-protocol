use anchor_lang::prelude::*;
use stede_hook::{
    cpi::{accounts::InitializeExtraAccountMetaList, initialize_extra_account_meta_list},
    program::StedeHook,
};

use crate::state::Vault;

#[derive(Accounts)]
pub struct InitializeVaultHook<'info> {
    /// Vault admin pays for the ExtraAccountMetaList account creation.
    #[account(mut)]
    pub admin: Signer<'info>,

    /// The vault for this Stede mint. Used to enforce admin == vault.admin.
    #[account(
        seeds = [Vault::SEED_PREFIX, vault.underlying_mint.as_ref()],
        bump = vault.bump,
        has_one = admin,
        has_one = stede_mint,
    )]
    pub vault: Account<'info, Vault>,

    /// The Stede mint that needs its ExtraAccountMetaList initialized.
    /// CHECK: validated by has_one on vault.
    pub stede_mint: UncheckedAccount<'info>,

    /// ExtraAccountMetaList PDA derived inside stede_hook program.
    /// Created via CPI to stede_hook::initialize_extra_account_meta_list.
    /// CHECK: created and validated by stede_hook.
    #[account(mut)]
    pub extra_account_meta_list: UncheckedAccount<'info>,

    /// stede_hook program (target of the CPI).
    pub stede_hook_program: Program<'info, StedeHook>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_vault_hook_handler(ctx: Context<InitializeVaultHook>) -> Result<()> {
    let cpi_accounts = InitializeExtraAccountMetaList {
        payer: ctx.accounts.admin.to_account_info(),
        extra_account_meta_list: ctx.accounts.extra_account_meta_list.to_account_info(),
        stede_mint: ctx.accounts.stede_mint.to_account_info(),
        system_program: ctx.accounts.system_program.to_account_info(),
    };

    initialize_extra_account_meta_list(CpiContext::new(
        ctx.accounts.stede_hook_program.to_account_info(),
        cpi_accounts,
    ))?;

    msg!(
        "Vault hook initialized. ExtraAccountMetaList created for Stede mint: {}",
        ctx.accounts.stede_mint.key()
    );

    Ok(())
}
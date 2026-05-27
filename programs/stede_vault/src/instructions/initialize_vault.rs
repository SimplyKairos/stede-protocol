use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::Token2022,
    token_interface::{Mint, TokenAccount},
};

use crate::state::Vault;

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    /// The wallet paying for account creation and set as admin.
    #[account(mut)]
    pub admin: Signer<'info>,

    /// The underlying stablecoin mint (e.g. USDC). Must be Token or Token-2022.
    pub underlying_mint: InterfaceAccount<'info, Mint>,

    /// The Vault PDA being initialized.
    /// One per (program, underlying_mint) pair.
    #[account(
        init,
        payer = admin,
        space = 8 + Vault::INIT_SPACE,
        seeds = [Vault::SEED_PREFIX, underlying_mint.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, Vault>,

    /// The Stede mint being created. A fresh Token-2022 mint with this
    /// vault as mint authority. Hook extension will be wired in Day 4
    /// (today it's a plain Token-2022 mint with the same decimals as
    /// the underlying).
    #[account(
        init,
        payer = admin,
        mint::token_program = token_program,
        mint::decimals = underlying_mint.decimals,
        mint::authority = vault,
        mint::freeze_authority = vault,
    )]
    pub stede_mint: InterfaceAccount<'info, Mint>,

    /// The token account that will hold locked underlying.
    /// Authority is the Vault PDA.
    #[account(
        init,
        payer = admin,
        token::mint = underlying_mint,
        token::authority = vault,
        token::token_program = underlying_token_program,
    )]
    pub token_vault: InterfaceAccount<'info, TokenAccount>,

    /// Token-2022 program (for the Stede mint).
    pub token_program: Program<'info, Token2022>,

    /// Token program for the underlying (could be classic SPL Token or
    /// Token-2022 depending on which stablecoin). Caller specifies.
    pub underlying_token_program: Interface<'info, anchor_spl::token_interface::TokenInterface>,

    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn initialize_vault_handler(ctx: Context<InitializeVault>) -> Result<()> {    let vault = &mut ctx.accounts.vault;

    vault.admin = ctx.accounts.admin.key();
    vault.underlying_mint = ctx.accounts.underlying_mint.key();
    vault.stede_mint = ctx.accounts.stede_mint.key();
    vault.token_vault = ctx.accounts.token_vault.key();
    vault.locked_amount = 0;
    vault.paused = false;
    vault.bump = ctx.bumps.vault;

    msg!(
        "Vault initialized. Underlying mint: {}. Stede mint: {}.",
        vault.underlying_mint,
        vault.stede_mint
    );

    Ok(())
}
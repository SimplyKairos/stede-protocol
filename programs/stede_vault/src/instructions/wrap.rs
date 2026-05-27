use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::{mint_to, MintTo, Token2022},
    token_interface::{
        transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
    },
};

use crate::{errors::VaultError, state::Vault};

#[derive(Accounts)]
pub struct Wrap<'info> {
    /// The user wrapping their stablecoin.
    #[account(mut)]
    pub user: Signer<'info>,

    /// Vault PDA (config + accounting).
    #[account(
        mut,
        seeds = [Vault::SEED_PREFIX, underlying_mint.key().as_ref()],
        bump = vault.bump,
        has_one = underlying_mint @ VaultError::MintMismatch,
        has_one = stede_mint @ VaultError::MintMismatch,
        has_one = token_vault @ VaultError::MintMismatch,
    )]
    pub vault: Account<'info, Vault>,

    /// The underlying stablecoin mint.
    pub underlying_mint: InterfaceAccount<'info, Mint>,

    /// The Stede mint.
    #[account(mut)]
    pub stede_mint: InterfaceAccount<'info, Mint>,

    /// The vault's token account (where underlying gets locked).
    #[account(mut)]
    pub token_vault: InterfaceAccount<'info, TokenAccount>,

    /// User's source token account (where underlying comes from).
    #[account(
        mut,
        token::mint = underlying_mint,
        token::authority = user,
    )]
    pub user_underlying_ata: InterfaceAccount<'info, TokenAccount>,

    /// User's destination Stede token account (where Stede dollars go).
    /// Must already exist. Frontend SDK creates it if needed.
    #[account(
        mut,
        token::mint = stede_mint,
        token::authority = user,
        token::token_program = token_program,
    )]
    pub user_stede_ata: InterfaceAccount<'info, TokenAccount>,

    /// Token-2022 program (for the Stede mint).
    pub token_program: Program<'info, Token2022>,

    /// Token program for the underlying.
    pub underlying_token_program: Interface<'info, TokenInterface>,
}

pub fn wrap_handler(ctx: Context<Wrap>, amount: u64) -> Result<()> {
    // Validation
    require!(!ctx.accounts.vault.paused, VaultError::Paused);
    require!(amount > 0, VaultError::ZeroAmount);

    // 1. Transfer underlying from user → token_vault
    let cpi_accounts = TransferChecked {
        from: ctx.accounts.user_underlying_ata.to_account_info(),
        mint: ctx.accounts.underlying_mint.to_account_info(),
        to: ctx.accounts.token_vault.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    let cpi_program = ctx.accounts.underlying_token_program.to_account_info();
    transfer_checked(
        CpiContext::new(cpi_program, cpi_accounts),
        amount,
        ctx.accounts.underlying_mint.decimals,
    )?;

    // 2. Mint Stede dollars to user. Vault PDA is the mint authority.
    let underlying_mint_key = ctx.accounts.underlying_mint.key();
    let bump = ctx.accounts.vault.bump;
    let vault_signer_seeds: &[&[&[u8]]] = &[&[
        Vault::SEED_PREFIX,
        underlying_mint_key.as_ref(),
        &[bump],
    ]];

    let cpi_accounts = MintTo {
        mint: ctx.accounts.stede_mint.to_account_info(),
        to: ctx.accounts.user_stede_ata.to_account_info(),
        authority: ctx.accounts.vault.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    mint_to(
        CpiContext::new_with_signer(cpi_program, cpi_accounts, vault_signer_seeds),
        amount,
    )?;

    // 3. Update accounting
    let vault = &mut ctx.accounts.vault;
    vault.locked_amount = vault
        .locked_amount
        .checked_add(amount)
        .ok_or(VaultError::Overflow)?;

    msg!("Wrapped {} units. Total locked: {}", amount, vault.locked_amount);

    Ok(())
}
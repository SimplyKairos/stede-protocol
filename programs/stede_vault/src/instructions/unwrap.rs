use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::{burn, Burn, Token2022},
    token_interface::{
        transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
    },
};

use crate::{errors::VaultError, state::Vault};

#[derive(Accounts)]
pub struct Unwrap<'info> {
    /// The user unwrapping their Stede dollars.
    #[account(mut)]
    pub user: Signer<'info>,

    /// Vault PDA.
    #[account(
        mut,
        seeds = [Vault::SEED_PREFIX, underlying_mint.key().as_ref()],
        bump = vault.bump,
        has_one = underlying_mint @ VaultError::MintMismatch,
        has_one = stede_mint @ VaultError::MintMismatch,
        has_one = token_vault @ VaultError::MintMismatch,
    )]
    pub vault: Account<'info, Vault>,

    pub underlying_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub stede_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub token_vault: InterfaceAccount<'info, TokenAccount>,

    /// User's Stede token account (where Stede dollars come from).
    #[account(
        mut,
        token::mint = stede_mint,
        token::authority = user,
        token::token_program = token_program,
    )]
    pub user_stede_ata: InterfaceAccount<'info, TokenAccount>,

    /// User's destination underlying token account (where the unlocked
    /// stablecoin goes).
    #[account(
        mut,
        token::mint = underlying_mint,
        token::authority = user,
    )]
    pub user_underlying_ata: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Program<'info, Token2022>,
    pub underlying_token_program: Interface<'info, TokenInterface>,
}

pub fn unwrap_handler(ctx: Context<Unwrap>, amount: u64) -> Result<()> {
    require!(!ctx.accounts.vault.paused, VaultError::Paused);
    require!(amount > 0, VaultError::ZeroAmount);
    require!(
        ctx.accounts.vault.locked_amount >= amount,
        VaultError::InsufficientLocked
    );

    // 1. Burn Stede dollars from user. User signs (they own the tokens).
    let cpi_accounts = Burn {
        mint: ctx.accounts.stede_mint.to_account_info(),
        from: ctx.accounts.user_stede_ata.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    burn(CpiContext::new(cpi_program, cpi_accounts), amount)?;

    // 2. Release underlying from token_vault → user. Vault PDA signs.
    let underlying_mint_key = ctx.accounts.underlying_mint.key();
    let bump = ctx.accounts.vault.bump;
    let vault_signer_seeds: &[&[&[u8]]] = &[&[
        Vault::SEED_PREFIX,
        underlying_mint_key.as_ref(),
        &[bump],
    ]];

    let cpi_accounts = TransferChecked {
        from: ctx.accounts.token_vault.to_account_info(),
        mint: ctx.accounts.underlying_mint.to_account_info(),
        to: ctx.accounts.user_underlying_ata.to_account_info(),
        authority: ctx.accounts.vault.to_account_info(),
    };
    let cpi_program = ctx.accounts.underlying_token_program.to_account_info();
    transfer_checked(
        CpiContext::new_with_signer(cpi_program, cpi_accounts, vault_signer_seeds),
        amount,
        ctx.accounts.underlying_mint.decimals,
    )?;

    // 3. Update accounting
    let vault = &mut ctx.accounts.vault;
    vault.locked_amount = vault
        .locked_amount
        .checked_sub(amount)
        .ok_or(VaultError::Overflow)?;

    msg!("Unwrapped {} units. Total locked: {}", amount, vault.locked_amount);

    Ok(())
}
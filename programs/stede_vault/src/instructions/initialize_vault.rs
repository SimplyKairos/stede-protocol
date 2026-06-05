use anchor_lang::prelude::*;
use anchor_lang::system_program::{create_account, CreateAccount};
use anchor_spl::{
    token_2022::{
        initialize_mint2,
        spl_token_2022::{
            extension::{transfer_hook, ExtensionType},
            state::Mint as SplMint,
        },
        InitializeMint2, Token2022,
    },
    token_2022_extensions::{
        metadata_pointer_initialize, spl_token_metadata_interface::state::TokenMetadata,
        token_metadata_initialize, MetadataPointerInitialize, TokenMetadataInitialize,
    },
    token_interface::{Mint, TokenAccount},
};
use stede_hook;

use crate::state::Vault;

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    /// The wallet paying for account creation and set as admin.
    #[account(mut)]
    pub admin: Signer<'info>,

    /// The underlying stablecoin mint (e.g. USDC).
    pub underlying_mint: InterfaceAccount<'info, Mint>,

    /// The Vault PDA being initialized.
    #[account(
        init,
        payer = admin,
        space = 8 + Vault::INIT_SPACE,
        seeds = [Vault::SEED_PREFIX, underlying_mint.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, Vault>,

    /// The Stede mint being created. Token-2022 with TransferHook + MetadataPointer
    /// extensions and self-hosted TokenMetadata. Created manually in the handler
    /// body because Anchor's `init` macro doesn't support Token-2022 extensions.
    /// CHECK: validated and initialized in the handler.
    #[account(mut, signer)]
    pub stede_mint: UncheckedAccount<'info>,

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

    /// Token program for the underlying.
    pub underlying_token_program: Interface<'info, anchor_spl::token_interface::TokenInterface>,

    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn initialize_vault_handler(
    ctx: Context<InitializeVault>,
    name: String,
    symbol: String,
    uri: String,
) -> Result<()> {
    let admin_key = ctx.accounts.admin.key();
    let underlying_mint_key = ctx.accounts.underlying_mint.key();
    let stede_mint_key = ctx.accounts.stede_mint.key();
    let token_vault_key = ctx.accounts.token_vault.key();
    let vault_key = ctx.accounts.vault.key();
    let underlying_decimals = ctx.accounts.underlying_mint.decimals;
    let vault_bump = ctx.bumps.vault;

    // Step 1: Calculate space + rent.
    //
    // Two of the three extensions are fixed-size and can be sized up-front with
    // `try_calculate_account_len`: TransferHook and MetadataPointer. TokenMetadata
    // is variable-length (its TLV size depends on the name/symbol/uri strings), so
    // it CANNOT go through `try_calculate_account_len` — that path panics for
    // variable-length extensions. Instead we:
    //   * allocate the account at the fixed-extension length (base mint +
    //     TransferHook + MetadataPointer), and
    //   * fund it with enough lamports for the fixed length PLUS the variable
    //     TokenMetadata TLV that the metadata `initialize` CPI will realloc in
    //     after the mint is initialized.
    // The metadata processor reallocs the account up and "assumes there's enough
    // SOL for the new rent-exemption", so the account must be pre-funded for the
    // FULL (fixed + metadata) size, even though it's allocated shorter.
    let extensions = vec![ExtensionType::TransferHook, ExtensionType::MetadataPointer];
    let base_size = ExtensionType::try_calculate_account_len::<SplMint>(&extensions)
        .map_err(|_| ProgramError::InvalidArgument)?;

    // Variable TokenMetadata TLV size for the actual args. `tlv_size_of` returns the
    // full TLV entry length (type+length header + packed metadata). update_authority
    // is a fixed 32-byte field regardless of value, so we don't need to set it here
    // just to measure the size.
    let token_metadata = TokenMetadata {
        mint: stede_mint_key,
        name: name.clone(),
        symbol: symbol.clone(),
        uri: uri.clone(),
        ..Default::default()
    };
    let metadata_tlv_size = token_metadata.tlv_size_of()?;

    let total_size = base_size
        .checked_add(metadata_tlv_size)
        .ok_or(ProgramError::InvalidArgument)?;

    let rent = Rent::get()?;
    let lamports = rent.minimum_balance(total_size);

    // Step 2: Create the mint account at the stede_mint pubkey.
    // Allocated at `base_size` (fixed extensions), funded for `total_size`.
    create_account(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            CreateAccount {
                from: ctx.accounts.admin.to_account_info(),
                to: ctx.accounts.stede_mint.to_account_info(),
            },
        ),
        lamports,
        base_size as u64,
        ctx.accounts.token_program.key,
    )?;

    // Step 3a: Initialize the TransferHook extension, pointing at stede_hook.
    // All fixed-size extensions must be initialized BEFORE initialize_mint2.
    let init_hook_ix = transfer_hook::instruction::initialize(
        ctx.accounts.token_program.key,
        &stede_mint_key,
        Some(vault_key),      // hook authority — vault can update the hook later
        Some(stede_hook::ID), // hook program — stede_hook fires on every transfer
    )
    .map_err(|_| ProgramError::InvalidArgument)?;
    anchor_lang::solana_program::program::invoke(
        &init_hook_ix,
        &[
            ctx.accounts.stede_mint.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
        ],
    )?;

    // Step 3b: Initialize the MetadataPointer extension (also BEFORE initialize_mint2).
    // The pointer is a self-pointer: metadata lives in the mint account itself, the
    // standard Token-2022 pattern. Pointer authority is the vault PDA.
    metadata_pointer_initialize(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            MetadataPointerInitialize {
                token_program_id: ctx.accounts.token_program.to_account_info(),
                mint: ctx.accounts.stede_mint.to_account_info(),
            },
        ),
        Some(vault_key),      // metadata pointer authority — vault can update later
        Some(stede_mint_key), // metadata_address — the mint points at itself
    )?;

    // Step 4: Initialize the mint itself with vault as mint/freeze authority.
    initialize_mint2(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            InitializeMint2 {
                mint: ctx.accounts.stede_mint.to_account_info(),
            },
        ),
        underlying_decimals,
        &vault_key,       // mint authority — vault mints/burns Stede
        Some(&vault_key), // freeze authority — vault can freeze if needed
    )?;

    // Step 5: Write the TokenMetadata via the spl-token-metadata-interface
    // `initialize` instruction, CPI'd to Token-2022 and signed by the vault PDA
    // (the mint authority). This is the variable-length write that reallocs the
    // account up to `total_size`. Must happen AFTER initialize_mint2.
    //
    // Reuse the EXACT vault signer seeds used for the mint authority elsewhere
    // (e.g. wrap's mint_to): [SEED_PREFIX, underlying_mint, bump].
    let vault_signer_seeds: &[&[&[u8]]] =
        &[&[Vault::SEED_PREFIX, underlying_mint_key.as_ref(), &[vault_bump]]];
    token_metadata_initialize(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TokenMetadataInitialize {
                program_id: ctx.accounts.token_program.to_account_info(),
                metadata: ctx.accounts.stede_mint.to_account_info(),
                update_authority: ctx.accounts.vault.to_account_info(),
                mint_authority: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.stede_mint.to_account_info(),
            },
            vault_signer_seeds,
        ),
        name,
        symbol,
        uri,
    )?;

    // Step 6: Populate vault PDA.
    let vault = &mut ctx.accounts.vault;
    vault.admin = admin_key;
    vault.underlying_mint = underlying_mint_key;
    vault.stede_mint = stede_mint_key;
    vault.token_vault = token_vault_key;
    vault.locked_amount = 0;
    vault.paused = false;
    vault.bump = vault_bump;

    msg!(
        "Vault initialized with hook-attached Stede mint. Underlying: {}. Stede: {}. Hook program: {}.",
        underlying_mint_key,
        stede_mint_key,
        stede_hook::ID,
    );

    Ok(())
}

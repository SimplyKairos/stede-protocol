use anchor_lang::prelude::*;
use anchor_lang::system_program::{create_account, CreateAccount};
use anchor_spl::token_interface::Mint;
use spl_tlv_account_resolution::{
    account::ExtraAccountMeta,
    state::ExtraAccountMetaList,
};
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

use crate::state::EXTRA_ACCOUNT_META_LIST_SEED;
use stede_rule_daily_limit;
use stede_rule_block_handle;

#[derive(Accounts)]
pub struct InitializeExtraAccountMetaList<'info> {
    /// Payer for the new ExtraAccountMetaList account.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The ExtraAccountMetaList PDA. Stores which extra accounts Token-2022
    /// must pass to our execute() instruction on every transfer.
    /// CHECK: We initialize this manually via system_program::create_account
    /// because Anchor's `init` doesn't know about the spl-tlv layout.
    #[account(
        mut,
        seeds = [EXTRA_ACCOUNT_META_LIST_SEED, stede_mint.key().as_ref()],
        bump,
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,

    /// The Stede mint this hook will guard. Must already be created
    /// with the transfer_hook extension configured to point at our program.
    pub stede_mint: InterfaceAccount<'info, Mint>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_extra_account_meta_list_handler(
    ctx: Context<InitializeExtraAccountMetaList>,
) -> Result<()> {
   // Day 5: the hook needs four extra accounts now — two per rule:
    //
    //   Daily limit:
    //     Index 5: stede_rule_daily_limit program (literal)
    //     Index 6: DailyLimit PDA, derived from (owner, stede_mint)
    //
    //   Block list:
    //     Index 7: stede_rule_block_handle program (literal)
    //     Index 8: BlockList PDA, derived from (owner, stede_mint)
    //
    // Token-2022's hook interface resolves these at transfer time, passing
    // them after the fixed 5 accounts that the hook itself receives.
    let extra_accounts: Vec<ExtraAccountMeta> = vec![
        // Daily limit rule program (index 5 in the full hook account list)
        ExtraAccountMeta::new_with_pubkey(&stede_rule_daily_limit::ID, false, false)?,
        // Daily limit PDA (index 6) — derived per transfer
        ExtraAccountMeta::new_external_pda_with_seeds(
            5, // index of the rule program in the full account list
            &[
                spl_tlv_account_resolution::seeds::Seed::Literal {
                    bytes: b"rule_daily_limit".to_vec(),
                },
                spl_tlv_account_resolution::seeds::Seed::AccountKey { index: 3 }, // owner
                spl_tlv_account_resolution::seeds::Seed::AccountKey { index: 1 }, // stede_mint
            ],
            false, // is_signer
            true,  // is_writable
        )?,
        // Block list rule program (index 7)
        ExtraAccountMeta::new_with_pubkey(&stede_rule_block_handle::ID, false, false)?,
        // Block list PDA (index 8) — derived per transfer
        ExtraAccountMeta::new_external_pda_with_seeds(
            7, // index of the block rule program
            &[
                spl_tlv_account_resolution::seeds::Seed::Literal {
                    bytes: b"rule_block_handle".to_vec(),
                },
                spl_tlv_account_resolution::seeds::Seed::AccountKey { index: 3 }, // owner
                spl_tlv_account_resolution::seeds::Seed::AccountKey { index: 1 }, // stede_mint
            ],
            false, // is_signer
            false, // is_writable — check_transfer doesn't mutate
        )?,
    ];
    
    // Compute the size and rent needed for the account.
    let account_size = ExtraAccountMetaList::size_of(extra_accounts.len())?;
    let lamports = Rent::get()?.minimum_balance(account_size);

    // Create the account at the PDA address. We need to do this manually
    // (rather than via Anchor's `init`) because the spl-tlv crate manages
    // the layout itself.
    let stede_mint_key = ctx.accounts.stede_mint.key();
    let signer_seeds: &[&[&[u8]]] = &[&[
        EXTRA_ACCOUNT_META_LIST_SEED,
        stede_mint_key.as_ref(),
        &[ctx.bumps.extra_account_meta_list],
    ]];

    create_account(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            CreateAccount {
                from: ctx.accounts.payer.to_account_info(),
                to: ctx.accounts.extra_account_meta_list.to_account_info(),
            },
            signer_seeds,
        ),
        lamports,
        account_size as u64,
        &crate::ID,
    )?;

    // Initialize the ExtraAccountMetaList structure inside the account.
    let mut data = ctx.accounts.extra_account_meta_list.try_borrow_mut_data()?;
    ExtraAccountMetaList::init::<ExecuteInstruction>(&mut data, &extra_accounts)?;

    msg!(
        "ExtraAccountMetaList initialized for mint {}. Extra accounts: {}",
        stede_mint_key,
        extra_accounts.len()
    );

    Ok(())
}
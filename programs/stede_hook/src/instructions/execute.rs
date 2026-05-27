use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use stede_rule_daily_limit::{
    cpi::{accounts::CheckTransfer as DailyLimitCheckTransfer, check_transfer as daily_limit_check_transfer},
    program::StedeRuleDailyLimit,
};
use stede_rule_block_handle::{
    cpi::{accounts::CheckTransfer as BlockListCheckTransfer, check_transfer as block_list_check_transfer},
    program::StedeRuleBlockHandle,
};

/// Accounts Token-2022 passes to our execute() on every transfer.
/// First 5 are fixed by the SPL Transfer Hook Interface.
/// Last 4 are declared in our ExtraAccountMetaList.
#[derive(Accounts)]
pub struct Execute<'info> {
    /// CHECK: source token account, validated by Token-2022.
    pub source_token: UncheckedAccount<'info>,

    pub stede_mint: InterfaceAccount<'info, Mint>,

    /// CHECK: destination token account, validated by Token-2022.
    pub destination_token: UncheckedAccount<'info>,

    /// CHECK: owner of source, validated by Token-2022.
    pub owner: UncheckedAccount<'info>,

    /// CHECK: ExtraAccountMetaList PDA, derived by hook interface.
    pub extra_account_meta_list: UncheckedAccount<'info>,

    // ---- Extra accounts declared in ExtraAccountMetaList ----

    pub stede_rule_daily_limit_program: Program<'info, StedeRuleDailyLimit>,

    /// CHECK: DailyLimit PDA, validated by daily limit program.
    #[account(mut)]
    pub daily_limit_pda: UncheckedAccount<'info>,

    pub stede_rule_block_handle_program: Program<'info, StedeRuleBlockHandle>,

    /// CHECK: BlockList PDA, validated by block list program.
    pub block_list_pda: UncheckedAccount<'info>,
}

pub fn execute_handler(ctx: Context<Execute>, amount: u64) -> Result<()> {
    msg!("stede_hook execute() invoked. CPIing into rules.");

    // Rule 1: daily limit. CPIs into stede_rule_daily_limit::check_transfer.
    let daily_limit_accounts = DailyLimitCheckTransfer {
        daily_limit: ctx.accounts.daily_limit_pda.to_account_info(),
    };
    daily_limit_check_transfer(
        CpiContext::new(
            ctx.accounts.stede_rule_daily_limit_program.to_account_info(),
            daily_limit_accounts,
        ),
        amount,
    )?;
    msg!("Daily limit rule passed.");

    // Rule 2: block list. CPIs into stede_rule_block_handle::check_transfer.
    // We need to extract the recipient's wallet from the destination token account.
    // The destination token account stores the owner's pubkey at offset 32 (after the mint).
    let destination_data = ctx.accounts.destination_token.try_borrow_data()?;
    let recipient_wallet = Pubkey::try_from(&destination_data[32..64])
        .map_err(|_| ProgramError::InvalidAccountData)?;
    drop(destination_data);

    let block_list_accounts = BlockListCheckTransfer {
        block_list: ctx.accounts.block_list_pda.to_account_info(),
    };
    block_list_check_transfer(
        CpiContext::new(
            ctx.accounts.stede_rule_block_handle_program.to_account_info(),
            block_list_accounts,
        ),
        recipient_wallet,
    )?;
    msg!("Block list rule passed.");

    Ok(())
}
use anchor_lang::prelude::*;

use crate::{errors::BlockHandleError, state::BlockList};

#[derive(Accounts)]
pub struct CheckTransfer<'info> {
    /// The sender's BlockList PDA.
    #[account(
        seeds = [
            BlockList::SEED_PREFIX,
            block_list.sender.as_ref(),
            block_list.stede_mint.as_ref(),
        ],
        bump = block_list.bump,
    )]
    pub block_list: Account<'info, BlockList>,
}

pub fn check_transfer_handler(
    ctx: Context<CheckTransfer>,
    recipient_wallet: Pubkey,
) -> Result<()> {
    let block_list = &ctx.accounts.block_list;

    require!(
        block_list.find(&recipient_wallet).is_none(),
        BlockHandleError::RecipientBlocked
    );

    msg!(
        "Block list check passed: recipient {} not on sender {}'s list",
        recipient_wallet,
        block_list.sender,
    );

    Ok(())
}
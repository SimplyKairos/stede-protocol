use anchor_lang::prelude::*;

use crate::{errors::BlockHandleError, state::BlockList};

#[derive(Accounts)]
pub struct RemoveBlocked<'info> {
    pub sender: Signer<'info>,

    /// CHECK: pubkey input, used as PDA seed.
    pub stede_mint: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [BlockList::SEED_PREFIX, sender.key().as_ref(), stede_mint.key().as_ref()],
        bump = block_list.bump,
        has_one = sender,
        has_one = stede_mint,
    )]
    pub block_list: Account<'info, BlockList>,
}

pub fn remove_blocked_handler(
    ctx: Context<RemoveBlocked>,
    blocked_wallet: Pubkey,
) -> Result<()> {
    let block_list = &mut ctx.accounts.block_list;

    let slot = block_list
        .find(&blocked_wallet)
        .ok_or(BlockHandleError::NotBlocked)?;

    block_list.blocked[slot] = Pubkey::default();
    block_list.count = block_list.count.saturating_sub(1);

    msg!(
        "Removed {} from block list. Count: {}",
        blocked_wallet,
        block_list.count,
    );

    Ok(())
}
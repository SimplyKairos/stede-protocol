use anchor_lang::prelude::*;

use crate::{errors::BlockHandleError, state::BlockList};

#[derive(Accounts)]
pub struct AddBlocked<'info> {
    /// The sender owning this block list.
    #[account(mut)]
    pub sender: Signer<'info>,

    /// CHECK: pubkey input, used as PDA seed and stored as data.
    pub stede_mint: UncheckedAccount<'info>,

    /// The BlockList PDA for (sender, stede_mint).
    /// init_if_needed: first add creates the PDA, subsequent adds reuse it.
    #[account(
        init_if_needed,
        payer = sender,
        space = 8 + BlockList::INIT_SPACE,
        seeds = [BlockList::SEED_PREFIX, sender.key().as_ref(), stede_mint.key().as_ref()],
        bump,
    )]
    pub block_list: Account<'info, BlockList>,

    pub system_program: Program<'info, System>,
}

pub fn add_blocked_handler(ctx: Context<AddBlocked>, blocked_wallet: Pubkey) -> Result<()> {
    require!(blocked_wallet != Pubkey::default(), BlockHandleError::ZeroAddress);

    let block_list = &mut ctx.accounts.block_list;

    // First-time PDA creation: initialize the metadata fields.
    if block_list.sender == Pubkey::default() {
        block_list.sender = ctx.accounts.sender.key();
        block_list.stede_mint = ctx.accounts.stede_mint.key();
        block_list.count = 0;
        block_list.bump = ctx.bumps.block_list;
        // `blocked` array defaults to [Pubkey::default(); 32] via Anchor's
        // init zeroing. No manual init needed.
    }

    // Reject duplicates.
    require!(
        block_list.find(&blocked_wallet).is_none(),
        BlockHandleError::AlreadyBlocked
    );

    // Find first empty slot.
    let slot = block_list
        .first_empty()
        .ok_or(BlockHandleError::BlockListFull)?;

    block_list.blocked[slot] = blocked_wallet;
    block_list.count = block_list.count.saturating_add(1);

    msg!(
        "Added {} to block list for sender {} on mint {}. Count: {}",
        blocked_wallet,
        block_list.sender,
        block_list.stede_mint,
        block_list.count,
    );

    Ok(())
}
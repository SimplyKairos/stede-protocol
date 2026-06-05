use anchor_lang::prelude::*;

use crate::{errors::BlockHandleError, state::BlockList};

#[derive(Accounts)]
pub struct CheckTransfer<'info> {
    /// The sender's BlockList PDA. MAY NOT EXIST — if the sender has never
    /// blocked anyone, this account is empty and the rule auto-passes (fails
    /// open), matching the opt-in behaviour of every other Stede rule.
    /// Existence + ownership + canonical PDA are validated manually below.
    /// CHECK: validated in the handler.
    pub block_list: UncheckedAccount<'info>,
}

pub fn check_transfer_handler(
    ctx: Context<CheckTransfer>,
    recipient_wallet: Pubkey,
) -> Result<()> {
    let info = ctx.accounts.block_list.to_account_info();

    // OPT-IN: no config (empty / zero-lamport account) => no one blocked => pass.
    if info.data_is_empty() || info.lamports() == 0 {
        msg!("Block list not configured for this sender. Auto-pass.");
        return Ok(());
    }

    require_keys_eq!(
        *info.owner,
        *ctx.program_id,
        BlockHandleError::InvalidConfigAccount
    );

    let block_list = {
        let data = info.try_borrow_data()?;
        let mut slice: &[u8] = &data;
        BlockList::try_deserialize(&mut slice)?
    };

    let (expected, _) =
        BlockList::pda(&block_list.sender, &block_list.stede_mint, ctx.program_id);
    require_keys_eq!(
        ctx.accounts.block_list.key(),
        expected,
        BlockHandleError::InvalidConfigAccount
    );

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

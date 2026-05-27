use anchor_lang::prelude::*;

pub mod state;
pub mod errors;
pub mod instructions;

use instructions::*;

declare_id!("J1ZZNPoZXHb4qUS7TQKwxFnm9eBE7MFso7gnJkKrH2uq");

#[program]
pub mod stede_rule_block_handle {
    use super::*;

    pub fn add_blocked(ctx: Context<AddBlocked>, blocked_wallet: Pubkey) -> Result<()> {
        add_blocked_handler(ctx, blocked_wallet)
    }

    pub fn remove_blocked(ctx: Context<RemoveBlocked>, blocked_wallet: Pubkey) -> Result<()> {
        remove_blocked_handler(ctx, blocked_wallet)
    }

    pub fn check_transfer(ctx: Context<CheckTransfer>, recipient_wallet: Pubkey) -> Result<()> {
        check_transfer_handler(ctx, recipient_wallet)
    }
}
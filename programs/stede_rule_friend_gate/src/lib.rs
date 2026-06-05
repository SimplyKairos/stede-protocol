use anchor_lang::prelude::*;

pub mod state;
pub mod errors;
pub mod instructions;

use instructions::*;

declare_id!("C2ETjCNkHYdPzNZxJtufmnc3j5at2osxG6csrS9StNk5");

#[program]
pub mod stede_rule_friend_gate {
    use super::*;

    pub fn set_friend_gate(
        ctx: Context<SetFriendGate>,
        threshold: u64,
        friend_wallet: Pubkey,
    ) -> Result<()> {
        set_friend_gate_handler(ctx, threshold, friend_wallet)
    }

    pub fn disable_friend_gate(ctx: Context<DisableFriendGate>) -> Result<()> {
        disable_friend_gate_handler(ctx)
    }

    pub fn check_transfer(ctx: Context<CheckTransfer>, amount: u64) -> Result<()> {
        check_transfer_handler(ctx, amount)
    }
}
use anchor_lang::prelude::*;

pub mod state;
pub mod errors;
pub mod instructions;

use instructions::*;

declare_id!("GWhPqirCmLHiYQdHsPXNzG2YexVR6cXsspps8YhPhaRb");

#[program]
pub mod stede_rule_new_recipient_delay {
    use super::*;

    pub fn set_slow_send(ctx: Context<SetSlowSend>, delay_seconds: i64) -> Result<()> {
        set_slow_send_handler(ctx, delay_seconds)
    }

    pub fn disable_slow_send(ctx: Context<DisableSlowSend>) -> Result<()> {
        disable_slow_send_handler(ctx)
    }

    pub fn register_recipient(
        ctx: Context<RegisterRecipient>,
        recipient: Pubkey,
    ) -> Result<()> {
        register_recipient_handler(ctx, recipient)
    }

    pub fn check_transfer(ctx: Context<CheckTransfer>) -> Result<()> {
        check_transfer_handler(ctx)
    }
}
use anchor_lang::prelude::*;

pub mod state;
pub mod errors;
pub mod instructions;

use instructions::*;

declare_id!("4Cc51G1AnduEcwtYQTfUKNVmNnERmrBmUv7mCHRQSSUg");

#[program]
pub mod stede_rule_cooloff {
    use super::*;

    pub fn set_cooloff(
        ctx: Context<SetCooloff>,
        threshold: u64,
        duration_seconds: i64,
    ) -> Result<()> {
        set_cooloff_handler(ctx, threshold, duration_seconds)
    }

    pub fn disable_cooloff(ctx: Context<DisableCooloff>) -> Result<()> {
        disable_cooloff_handler(ctx)
    }

    pub fn check_transfer(ctx: Context<CheckTransfer>, amount: u64) -> Result<()> {
        check_transfer_handler(ctx, amount)
    }
}
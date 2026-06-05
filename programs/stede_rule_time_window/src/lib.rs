use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("8AEdTE3avK5jhVy8osXHfZYnvtn73SSVrRxwuTaytaGu");

#[program]
pub mod stede_rule_time_window {
    use super::*;

    pub fn set_time_window(
        ctx: Context<SetTimeWindow>,
        start_hour: u8,
        end_hour: u8,
    ) -> Result<()> {
        set_time_window_handler(ctx, start_hour, end_hour)
    }

    pub fn disable_time_window(ctx: Context<DisableTimeWindow>) -> Result<()> {
        disable_time_window_handler(ctx)
    }

    pub fn check_transfer(ctx: Context<CheckTransfer>, amount: u64) -> Result<()> {
        check_transfer_handler(ctx, amount)
    }
}

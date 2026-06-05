use anchor_lang::prelude::*;

use crate::errors::TimeWindowError;
use crate::state::SEED_PREFIX;

#[derive(Accounts)]
pub struct CheckTransfer<'info> {
    /// CHECK: optional config PDA, manually checked for existence below
    #[account(
        seeds = [SEED_PREFIX, sender.key().as_ref(), stede_mint.key().as_ref()],
        bump
    )]
    pub config: UncheckedAccount<'info>,

    /// CHECK: sender key only used as a PDA seed
    pub sender: UncheckedAccount<'info>,

    /// CHECK: mint key only used as a PDA seed
    pub stede_mint: UncheckedAccount<'info>,
}

pub fn check_transfer_handler(ctx: Context<CheckTransfer>, _amount: u64) -> Result<()> {
    let config_info = &ctx.accounts.config;

    // Opt-in: no config means the rule auto-passes.
    if config_info.data_is_empty() || config_info.lamports() == 0 {
        return Ok(());
    }

    let data = config_info.try_borrow_data()?;
    // Layout after 8-byte discriminator: sender(32) mint(32) start_hour(1) end_hour(1) bump(1)
    let start_hour = data[72];
    let end_hour = data[73];

    let now = Clock::get()?.unix_timestamp;
    let hour = (((now % 86_400) + 86_400) % 86_400) / 3600;
    let hour = hour as u8;

    let blocked = if start_hour <= end_hour {
        hour >= start_hour && hour < end_hour
    } else {
        hour >= start_hour || hour < end_hour
    };

    require!(!blocked, TimeWindowError::WithinBlockedWindow);

    Ok(())
}

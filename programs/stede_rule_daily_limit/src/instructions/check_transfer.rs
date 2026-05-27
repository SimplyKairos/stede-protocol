use anchor_lang::prelude::*;

use crate::{errors::DailyLimitError, state::DailyLimit};

#[derive(Accounts)]
pub struct CheckTransfer<'info> {
    /// The DailyLimit PDA for the sender being checked.
    /// Must be writable because we update spent_today and window_start_slot.
    #[account(
        mut,
        seeds = [
            DailyLimit::SEED_PREFIX,
            daily_limit.sender.as_ref(),
            daily_limit.stede_mint.as_ref(),
        ],
        bump = daily_limit.bump,
    )]
    pub daily_limit: Account<'info, DailyLimit>,
}

pub fn check_transfer_handler(ctx: Context<CheckTransfer>, amount: u64) -> Result<()> {
    let daily_limit = &mut ctx.accounts.daily_limit;
    let current_slot = Clock::get()?.slot;

    // Roll the window forward if 24h has passed.
    if current_slot.saturating_sub(daily_limit.window_start_slot) >= DailyLimit::SLOTS_PER_DAY {
        daily_limit.spent_today = 0;
        daily_limit.window_start_slot = current_slot;
        msg!("Daily window reset for {}", daily_limit.sender);
    }

    // Compute the new total and check against limit.
    let new_total = daily_limit
        .spent_today
        .checked_add(amount)
        .ok_or(DailyLimitError::Overflow)?;

    require!(
        new_total <= daily_limit.limit,
        DailyLimitError::DailyLimitExceeded
    );

    // Update spent_today.
    daily_limit.spent_today = new_total;

    msg!(
        "Daily limit check passed: {} spent_today after {} transfer, limit {}",
        daily_limit.spent_today,
        amount,
        daily_limit.limit
    );

    Ok(())
}
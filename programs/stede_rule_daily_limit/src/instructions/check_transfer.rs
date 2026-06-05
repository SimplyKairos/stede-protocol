use anchor_lang::prelude::*;

use crate::{errors::DailyLimitError, state::DailyLimit};

#[derive(Accounts)]
pub struct CheckTransfer<'info> {
    /// The sender's DailyLimit PDA. MAY NOT EXIST — if the sender has not set a
    /// daily limit, this account is empty (zero lamports / no data) and the rule
    /// auto-passes (fails open), matching the opt-in behaviour of every other
    /// Stede rule. Existence + ownership + canonical PDA are validated manually
    /// in the handler, so we accept it unchecked here.
    /// CHECK: validated in the handler.
    #[account(mut)]
    pub daily_limit: UncheckedAccount<'info>,
}

pub fn check_transfer_handler(ctx: Context<CheckTransfer>, amount: u64) -> Result<()> {
    let info = ctx.accounts.daily_limit.to_account_info();

    // OPT-IN: no config (empty / zero-lamport account) => rule not enabled => pass.
    if info.data_is_empty() || info.lamports() == 0 {
        msg!("Daily limit not configured for this sender. Auto-pass.");
        return Ok(());
    }

    // Config exists: it must be owned by this program and carry the right
    // discriminator, and live at the canonical PDA for its stored (sender, mint).
    require_keys_eq!(
        *info.owner,
        *ctx.program_id,
        DailyLimitError::InvalidConfigAccount
    );

    let mut daily_limit = {
        let data = info.try_borrow_data()?;
        let mut slice: &[u8] = &data;
        DailyLimit::try_deserialize(&mut slice)?
    };

    let (expected, _) =
        DailyLimit::pda(&daily_limit.sender, &daily_limit.stede_mint, ctx.program_id);
    require_keys_eq!(
        ctx.accounts.daily_limit.key(),
        expected,
        DailyLimitError::InvalidConfigAccount
    );

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

    // We deserialized manually, so persist the mutation explicitly.
    let mut data = info.try_borrow_mut_data()?;
    let mut writer = std::io::Cursor::new(&mut data[..]);
    daily_limit.try_serialize(&mut writer)?;

    Ok(())
}

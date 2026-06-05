use anchor_lang::prelude::*;

use crate::{errors::CooloffError, state::Cooloff};

#[derive(Accounts)]
pub struct CheckTransfer<'info> {
    /// The sender's Cooloff PDA. MAY NOT EXIST — if the sender has not enabled
    /// cool-off, this account is empty and the rule auto-passes (fails open),
    /// matching the opt-in behaviour of every other Stede rule. Mutable because
    /// we update last_large_transfer_at on every large transfer that passes.
    /// Existence + ownership + canonical PDA are validated manually below.
    /// CHECK: validated in the handler.
    #[account(mut)]
    pub cooloff: UncheckedAccount<'info>,
}

pub fn check_transfer_handler(ctx: Context<CheckTransfer>, amount: u64) -> Result<()> {
    let info = ctx.accounts.cooloff.to_account_info();

    // OPT-IN: no config (empty / zero-lamport account) => rule not enabled => pass.
    if info.data_is_empty() || info.lamports() == 0 {
        msg!("Cool-off not configured for this sender. Auto-pass.");
        return Ok(());
    }

    require_keys_eq!(
        *info.owner,
        *ctx.program_id,
        CooloffError::InvalidConfigAccount
    );

    let mut cooloff = {
        let data = info.try_borrow_data()?;
        let mut slice: &[u8] = &data;
        Cooloff::try_deserialize(&mut slice)?
    };

    let (expected, _) =
        Cooloff::pda(&cooloff.sender, &cooloff.stede_mint, ctx.program_id);
    require_keys_eq!(
        ctx.accounts.cooloff.key(),
        expected,
        CooloffError::InvalidConfigAccount
    );

    // Small transfers always pass; cool-off doesn't apply.
    if amount < cooloff.threshold {
        msg!(
            "Cooloff check passed: amount {} below threshold {}",
            amount,
            cooloff.threshold
        );
        return Ok(());
    }

    // This is a "large" transfer. Check if cool-off is currently active.
    let now = Clock::get()?.unix_timestamp;
    let elapsed = now
        .checked_sub(cooloff.last_large_transfer_at)
        .ok_or(CooloffError::Overflow)?;

    require!(
        elapsed >= cooloff.duration_seconds,
        CooloffError::CooloffActive
    );

    // Cool-off period has passed (or this is the first large transfer).
    // Approve and update the timestamp.
    cooloff.last_large_transfer_at = now;

    msg!(
        "Cooloff check passed: large transfer of {} approved. Next large transfer blocked for {}s.",
        amount,
        cooloff.duration_seconds
    );

    // We deserialized manually, so persist the mutation explicitly.
    let mut data = info.try_borrow_mut_data()?;
    let mut writer = std::io::Cursor::new(&mut data[..]);
    cooloff.try_serialize(&mut writer)?;

    Ok(())
}

use anchor_lang::prelude::*;

use crate::{
    errors::SlowSendError,
    state::{SlowSendConfig, SlowSendContact},
};

#[derive(Accounts)]
pub struct CheckTransfer<'info> {
    /// The sender's SlowSendConfig PDA. MAY NOT EXIST — if the user hasn't
    /// enabled Slow Send, this account is empty and the rule auto-passes.
    /// CHECK: existence and address validated manually in the handler.
    pub config: UncheckedAccount<'info>,

    /// The contact PDA for (sender, recipient, mint). MAY NOT EXIST.
    /// CHECK: existence and address validated manually in the handler.
    pub contact: UncheckedAccount<'info>,

    /// CHECK: the destination token account. Recipient wallet read from bytes 32-64.
    pub destination_token: UncheckedAccount<'info>,
}

pub fn check_transfer_handler(ctx: Context<CheckTransfer>) -> Result<()> {
    let config_info = &ctx.accounts.config;

    // OPT-IN: if the config PDA doesn't exist, the user hasn't enabled Slow Send.
    // The rule auto-passes.
    if config_info.data_is_empty() || config_info.lamports() == 0 {
        msg!("Slow Send not configured for this sender. Auto-pass.");
        return Ok(());
    }

    // Config exists. Deserialize it manually (skip 8-byte discriminator).
    let config_data = config_info.try_borrow_data()?;
    require!(config_data.len() >= 8 + SlowSendConfig::INIT_SPACE, SlowSendError::InvalidDestination);

    // SlowSendConfig layout after discriminator:
    //   sender: Pubkey (32)        offset 8..40
    //   stede_mint: Pubkey (32)    offset 40..72
    //   delay_seconds: i64 (8)     offset 72..80
    //   bump: u8 (1)               offset 80
    let config_sender = Pubkey::try_from(&config_data[8..40])
        .map_err(|_| SlowSendError::InvalidDestination)?;
    let config_stede_mint = Pubkey::try_from(&config_data[40..72])
        .map_err(|_| SlowSendError::InvalidDestination)?;
    let delay_seconds = i64::from_le_bytes(
        config_data[72..80]
            .try_into()
            .map_err(|_| SlowSendError::InvalidDestination)?,
    );
    let config_bump = config_data[80];
    drop(config_data);

    // Verify the config PDA is the legitimate one for (sender, mint).
    let (expected_config, _) = SlowSendConfig::pda(
        &config_sender,
        &config_stede_mint,
        ctx.program_id,
    );
    require_keys_eq!(
        config_info.key(),
        expected_config,
        SlowSendError::InvalidDestination
    );
    // Defensive: bump should match (cheap sanity check).
    let _ = config_bump;

    // Read recipient from the destination token account (owner at bytes 32-64).
    let destination_data = ctx.accounts.destination_token.try_borrow_data()?;
    require!(destination_data.len() >= 64, SlowSendError::InvalidDestination);
    let recipient = Pubkey::try_from(&destination_data[32..64])
        .map_err(|_| SlowSendError::InvalidDestination)?;
    drop(destination_data);

    // Derive the expected contact PDA.
    let (expected_contact, _) = SlowSendContact::pda(
        &config_sender,
        &recipient,
        &config_stede_mint,
        ctx.program_id,
    );
    require_keys_eq!(
        ctx.accounts.contact.key(),
        expected_contact,
        SlowSendError::InvalidDestination
    );

    // Config is enabled. The recipient MUST be registered and aged.
    let contact_info = &ctx.accounts.contact;
    if contact_info.data_is_empty() || contact_info.lamports() == 0 {
        return err!(SlowSendError::RecipientNotRegistered);
    }

    let contact_data = contact_info.try_borrow_data()?;
    require!(contact_data.len() >= 16, SlowSendError::RecipientNotRegistered);
    let first_contact_at = i64::from_le_bytes(
        contact_data[8..16]
            .try_into()
            .map_err(|_| SlowSendError::RecipientNotRegistered)?,
    );
    drop(contact_data);

    let now = Clock::get()?.unix_timestamp;
    let elapsed = now
        .checked_sub(first_contact_at)
        .ok_or(SlowSendError::Overflow)?;

    require!(
        elapsed >= delay_seconds,
        SlowSendError::WaitingPeriodActive
    );

    msg!(
        "Slow Send check passed: recipient {} registered {}s ago (delay {}s).",
        recipient,
        elapsed,
        delay_seconds,
    );

    Ok(())
}
use anchor_lang::prelude::*;

use crate::state::SlowSendContact;

#[derive(Accounts)]
#[instruction(recipient: Pubkey)]
pub struct RegisterRecipient<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,

    /// CHECK: pubkey input, used as PDA seed.
    pub stede_mint: UncheckedAccount<'info>,

    /// Contact PDA for (sender, recipient, stede_mint).
    /// init: registering a recipient already registered fails (which is fine;
    /// frontend checks existence first, or treats the error as "already registered").
    #[account(
        init,
        payer = sender,
        space = 8 + SlowSendContact::INIT_SPACE,
        seeds = [
            SlowSendContact::SEED_PREFIX,
            sender.key().as_ref(),
            recipient.as_ref(),
            stede_mint.key().as_ref(),
        ],
        bump,
    )]
    pub contact: Account<'info, SlowSendContact>,

    pub system_program: Program<'info, System>,
}

pub fn register_recipient_handler(
    ctx: Context<RegisterRecipient>,
    recipient: Pubkey,
) -> Result<()> {
    let clock = Clock::get()?;
    let contact = &mut ctx.accounts.contact;

    contact.first_contact_at = clock.unix_timestamp;
    contact.bump = ctx.bumps.contact;

    msg!(
        "Recipient {} registered by sender {} at {}. Waiting period starts now.",
        recipient,
        ctx.accounts.sender.key(),
        clock.unix_timestamp,
    );

    Ok(())
}
use anchor_lang::prelude::*;

/// Minimum slow-send delay: 1 second.
pub const MIN_DELAY_SECONDS: i64 = 1;

/// Maximum slow-send delay: 604800 seconds (7 days).
pub const MAX_DELAY_SECONDS: i64 = 604800;

/// Config PDA: one per (sender, stede_mint).
/// Seeds: ["slow_send_config", sender, stede_mint]
///
/// Stores the user's slow-send delay configuration. If this PDA exists,
/// the rule is active for that sender on that mint.
#[account]
#[derive(InitSpace)]
pub struct SlowSendConfig {
    /// The wallet this config belongs to.
    pub sender: Pubkey,

    /// The Stede mint this config applies to. Per-currency.
    pub stede_mint: Pubkey,

    /// How long a newly-registered recipient must "age" before transfers
    /// to them are allowed, in seconds.
    pub delay_seconds: i64,

    /// PDA bump.
    pub bump: u8,
}

impl SlowSendConfig {
    pub const SEED_PREFIX: &'static [u8] = b"slow_send_config";

    pub fn pda(sender: &Pubkey, stede_mint: &Pubkey, program_id: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[Self::SEED_PREFIX, sender.as_ref(), stede_mint.as_ref()],
            program_id,
        )
    }
}

/// Contact PDA: one per (sender, recipient, stede_mint).
/// Seeds: ["slow_send_contact", sender, recipient, stede_mint]
///
/// Created by `register_recipient`, recording when the user first registered
/// intent to send to this recipient. A transfer to the recipient is allowed
/// only once `now - first_contact_at >= config.delay_seconds`.
#[account]
#[derive(InitSpace)]
pub struct SlowSendContact {
    /// Unix timestamp (seconds) when this recipient was registered.
    pub first_contact_at: i64,

    /// PDA bump.
    pub bump: u8,
}

impl SlowSendContact {
    pub const SEED_PREFIX: &'static [u8] = b"slow_send_contact";

    pub fn pda(
        sender: &Pubkey,
        recipient: &Pubkey,
        stede_mint: &Pubkey,
        program_id: &Pubkey,
    ) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[
                Self::SEED_PREFIX,
                sender.as_ref(),
                recipient.as_ref(),
                stede_mint.as_ref(),
            ],
            program_id,
        )
    }
}
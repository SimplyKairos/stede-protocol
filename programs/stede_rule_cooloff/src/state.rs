use anchor_lang::prelude::*;

/// Maximum cool-off duration: 24 hours.
/// Anything longer feels like accidental lockout, not protection.
pub const MAX_DURATION_SECONDS: i64 = 86400;

/// Minimum cool-off duration: 1 second.
/// Zero-duration would be a no-op rule.
pub const MIN_DURATION_SECONDS: i64 = 1;

/// One Cooloff PDA per (sender, stede_mint) pair.
///
/// Stores the cool-off configuration plus the timestamp of the most recent
/// "large" transfer (one at or above threshold). The hook's check_transfer
/// CPI reads this PDA and rejects transfers that occur within `duration_seconds`
/// of `last_large_transfer_at` AND are themselves above threshold.
///
/// Small transfers (below threshold) are always approved by this rule.
#[account]
#[derive(InitSpace)]
pub struct Cooloff {
    /// The wallet this rule belongs to (the sender).
    pub sender: Pubkey,

    /// The Stede mint this rule applies to. Rules are per-currency.
    pub stede_mint: Pubkey,

    /// Transfers at or above this amount trigger the cool-off timer.
    /// Below this amount, transfers are always approved by this rule.
    pub threshold: u64,

    /// Cool-off duration in seconds. After a large transfer, the user is
    /// blocked from making another large transfer for this many seconds.
    pub duration_seconds: i64,

    /// Unix timestamp (seconds) of the most recent transfer at or above threshold.
    /// 0 means no large transfer has occurred yet.
    pub last_large_transfer_at: i64,

    /// PDA bump.
    pub bump: u8,
}

impl Cooloff {
    pub const SEED_PREFIX: &'static [u8] = b"rule_cooloff";

    pub fn pda(sender: &Pubkey, stede_mint: &Pubkey, program_id: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[Self::SEED_PREFIX, sender.as_ref(), stede_mint.as_ref()],
            program_id,
        )
    }
}
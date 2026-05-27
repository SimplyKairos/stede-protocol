use anchor_lang::prelude::*;

/// One DailyLimit PDA per (sender, stede_mint) pair.
///
/// Tracks how much the sender has moved in the current 24h window.
/// The hook CPI's `check_transfer` updates `spent_today` and rolls the window
/// forward when needed.
#[account]
#[derive(InitSpace)]
pub struct DailyLimit {
    /// The wallet this limit applies to.
    pub sender: Pubkey,

    /// The Stede mint this limit applies to. Daily limits are per-currency.
    pub stede_mint: Pubkey,

    /// The maximum amount (in base units) the sender can transfer per 24h window.
    pub limit: u64,

    /// How much has been transferred so far in the current window.
    pub spent_today: u64,

    /// The slot the current 24h window started.
    pub window_start_slot: u64,

    /// PDA bump.
    pub bump: u8,
}

impl DailyLimit {
    pub const SEED_PREFIX: &'static [u8] = b"rule_daily_limit";

    /// Slots per 24h window. Solana targets ~400ms per slot,
    /// so 24h ≈ 216,000 slots. Conservative: we use 216,000.
    pub const SLOTS_PER_DAY: u64 = 216_000;

    pub fn pda(sender: &Pubkey, stede_mint: &Pubkey, program_id: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[Self::SEED_PREFIX, sender.as_ref(), stede_mint.as_ref()],
            program_id,
        )
    }
}
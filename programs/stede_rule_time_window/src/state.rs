use anchor_lang::prelude::*;

pub const SEED_PREFIX: &[u8] = b"time_window";

#[account]
#[derive(InitSpace)]
pub struct TimeWindowConfig {
    pub sender: Pubkey,
    pub stede_mint: Pubkey,
    pub start_hour: u8,
    pub end_hour: u8,
    pub bump: u8,
}

impl TimeWindowConfig {
    pub fn pda(sender: &Pubkey, stede_mint: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[SEED_PREFIX, sender.as_ref(), stede_mint.as_ref()],
            &crate::ID,
        )
    }
}

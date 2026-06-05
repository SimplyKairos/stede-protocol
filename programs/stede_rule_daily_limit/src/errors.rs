use anchor_lang::prelude::*;

#[error_code]
pub enum DailyLimitError {
    #[msg("Transfer would exceed the daily limit set for this sender.")]
    DailyLimitExceeded,

    #[msg("Daily limit must be greater than zero.")]
    ZeroLimit,

    #[msg("Arithmetic overflow.")]
    Overflow,

    #[msg("Daily limit config account is not the canonical PDA for its sender/mint.")]
    InvalidConfigAccount,
}
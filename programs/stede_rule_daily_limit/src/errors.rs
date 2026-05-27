use anchor_lang::prelude::*;

#[error_code]
pub enum DailyLimitError {
    #[msg("Transfer would exceed the daily limit set for this sender.")]
    DailyLimitExceeded,

    #[msg("Daily limit must be greater than zero.")]
    ZeroLimit,

    #[msg("Arithmetic overflow.")]
    Overflow,
}
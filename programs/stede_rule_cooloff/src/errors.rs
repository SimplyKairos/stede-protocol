use anchor_lang::prelude::*;

#[error_code]
pub enum CooloffError {
    #[msg("Cool-off active: another large transfer was made recently.")]
    CooloffActive,

    #[msg("Threshold must be greater than zero.")]
    ZeroThreshold,

    #[msg("Duration must be between 1 and 86400 seconds (24h).")]
    InvalidDuration,

    #[msg("Arithmetic overflow.")]
    Overflow,

    #[msg("Cool-off config account is not the canonical PDA for its sender/mint.")]
    InvalidConfigAccount,
}
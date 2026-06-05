use anchor_lang::prelude::*;

#[error_code]
pub enum TimeWindowError {
    #[msg("Transfers are blocked during the configured night mode hours")]
    WithinBlockedWindow,
    #[msg("Hour values must be between 0 and 23")]
    InvalidHour,
}

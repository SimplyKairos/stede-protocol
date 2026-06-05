use anchor_lang::prelude::*;

#[error_code]
pub enum SlowSendError {
    #[msg("Recipient is not registered. Register them to start the waiting period.")]
    RecipientNotRegistered,

    #[msg("Waiting period still active for this recipient.")]
    WaitingPeriodActive,

    #[msg("Delay must be between 1 and 604800 seconds (1 second to 7 days).")]
    InvalidDelay,

    #[msg("Arithmetic overflow.")]
    Overflow,

    #[msg("Could not read recipient from destination token account.")]
    InvalidDestination,
}
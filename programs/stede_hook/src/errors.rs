use anchor_lang::prelude::*;

#[error_code]
pub enum HookError {
    #[msg("Mint provided does not have the transfer hook extension enabled.")]
    MissingTransferHook,

    #[msg("Source account is not currently transferring (mint authority check failed).")]
    NotCurrentlyTransferring,

    #[msg("Amount mismatch between hook and underlying transfer.")]
    AmountMismatch,
}